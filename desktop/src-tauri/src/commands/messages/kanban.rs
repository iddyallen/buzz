//! NIP-KB channel Kanban board — list and publish `kind:40110` card events.
//!
//! Every create / edit / move / delete is one fresh `kind:40110` event (tags
//! are the full desired state, never a delta). The board is reconstructed by
//! keeping only the newest version per `d` (card id) and dropping tombstones.
//! Tag layout and validation come from `buzz_core_pkg::kanban` so this builder
//! and the relay-side validator cannot drift.

use std::collections::HashMap;

use nostr::{EventBuilder, Kind, Tag};
use tauri::State;
use uuid::Uuid;

use buzz_core_pkg::kanban::{KanbanCard, KanbanColumn};

use crate::{
    app_state::AppState,
    events::check_content,
    models::{KanbanCardInfo, KanbanCardsResponse},
    relay::{query_relay, submit_event},
};

/// Parse a `col` string coming from the frontend into a [`KanbanColumn`].
fn parse_column(col: &str) -> Result<KanbanColumn, String> {
    KanbanColumn::parse(col).ok_or_else(|| format!("invalid column: {col}"))
}

/// Build a `kind:40110` NIP-KB card event from the desired card state.
#[allow(clippy::too_many_arguments)]
fn build_card(
    channel_id: Uuid,
    card_id: Uuid,
    column: KanbanColumn,
    position: f64,
    title: &str,
    description: &str,
    assignee: Option<String>,
    source_event_id: Option<String>,
    deleted: bool,
) -> Result<EventBuilder, String> {
    check_content(description)?;
    check_content(title)?;
    let card = KanbanCard {
        channel_id,
        card_id,
        column,
        position,
        title: title.to_string(),
        description: description.to_string(),
        assignee,
        source_event_id,
        deleted,
    };
    let tags = card
        .to_tag_rows()
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("invalid card tag: {e}"))?;
    Ok(EventBuilder::new(Kind::Custom(40110), description).tags(tags))
}

fn info_from_card(event: &nostr::Event, card: &KanbanCard) -> KanbanCardInfo {
    KanbanCardInfo {
        event_id: event.id.to_hex(),
        pubkey: event.pubkey.to_hex(),
        card_id: card.card_id.to_string(),
        column: card.column.as_str().to_string(),
        position: card.position,
        title: card.title.clone(),
        description: card.description.clone(),
        assignee: card.assignee.clone(),
        source_event_id: card.source_event_id.clone(),
        created_at: event.created_at.as_secs() as i64,
        channel_id: card.channel_id.to_string(),
    }
}

/// Whether `candidate` should replace `current` as the winning version of a
/// card: newer `created_at` wins; on a tie the lexically-greater event id wins.
fn is_newer(candidate: &nostr::Event, current: &nostr::Event) -> bool {
    match candidate.created_at.cmp(&current.created_at) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => candidate.id.to_hex() > current.id.to_hex(),
    }
}

/// List the live cards on a channel's board.
///
/// Returns one entry per `d`, using the newest version and dropping any card
/// whose winning version is a tombstone. Ordering is left to the client.
#[tauri::command]
pub async fn get_channel_kanban_cards(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<KanbanCardsResponse, String> {
    let filter = serde_json::json!({
        "kinds": [40110],
        "#h": [channel_id.clone()],
        "limit": 2000,
    });

    let events = query_relay(&state, &[filter]).await?;

    // Keep the winning event per card id.
    let mut winners: HashMap<Uuid, (nostr::Event, KanbanCard)> = HashMap::new();
    for event in events {
        let Ok(card) = KanbanCard::from_event(&event) else {
            continue;
        };
        match winners.get(&card.card_id) {
            Some((current, _)) if !is_newer(&event, current) => {}
            _ => {
                winners.insert(card.card_id, (event, card));
            }
        }
    }

    let mut cards: Vec<KanbanCardInfo> = winners
        .values()
        .filter(|(_, card)| !card.deleted)
        .map(|(event, card)| info_from_card(event, card))
        .collect();
    // Stable, deterministic order; the client re-sorts per column by position.
    cards.sort_by(|a, b| {
        a.position
            .partial_cmp(&b.position)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.created_at.cmp(&b.created_at))
            .then_with(|| a.event_id.cmp(&b.event_id))
    });

    Ok(KanbanCardsResponse { cards })
}

/// Publish a `kind:40110` card version. One command covers create, edit, move,
/// and delete: the caller sends the full desired state, and `deleted = true`
/// publishes a tombstone.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn publish_kanban_card(
    channel_id: String,
    card_id: String,
    column: String,
    position: f64,
    title: String,
    description: Option<String>,
    assignee: Option<String>,
    source_event_id: Option<String>,
    deleted: Option<bool>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let channel_uuid =
        Uuid::parse_str(&channel_id).map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let card_uuid =
        Uuid::parse_str(&card_id).map_err(|_| format!("invalid card UUID: {card_id}"))?;
    let column = parse_column(&column)?;

    let builder = build_card(
        channel_uuid,
        card_uuid,
        column,
        position,
        &title,
        description.as_deref().unwrap_or(""),
        assignee.filter(|s| !s.is_empty()),
        source_event_id.filter(|s| !s.is_empty()),
        deleted.unwrap_or(false),
    )?;

    let response = submit_event(builder, &state).await?;
    Ok(response.event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn card_event(created_at: u64, tags: &[[&str; 2]], content: &str) -> nostr::Event {
        let keys = Keys::generate();
        EventBuilder::new(Kind::Custom(40110), content)
            .tags(tags.iter().map(|p| Tag::parse(p.to_vec()).expect("tag")))
            .custom_created_at(nostr::Timestamp::from(created_at))
            .sign_with_keys(&keys)
            .expect("sign")
    }

    const CHAN: &str = "6f9d2c1e-1b7a-4a2e-9f3c-2b8e5d4a1c00";
    const CARD: &str = "11111111-2222-3333-4444-555555555555";

    #[test]
    fn is_newer_prefers_higher_created_at_then_id() {
        let older = card_event(
            100,
            &[
                ["h", CHAN],
                ["d", CARD],
                ["col", "todo"],
                ["pos", "1"],
                ["title", "a"],
            ],
            "",
        );
        let newer = card_event(
            200,
            &[
                ["h", CHAN],
                ["d", CARD],
                ["col", "doing"],
                ["pos", "1"],
                ["title", "a"],
            ],
            "",
        );
        assert!(is_newer(&newer, &older));
        assert!(!is_newer(&older, &newer));
    }

    #[test]
    fn builder_round_trips_through_core_parser() {
        let builder = build_card(
            Uuid::parse_str(CHAN).unwrap(),
            Uuid::parse_str(CARD).unwrap(),
            KanbanColumn::Doing,
            2.5,
            "Ship it",
            "the description",
            None,
            None,
            false,
        )
        .expect("build");
        let keys = Keys::generate();
        let event = builder.sign_with_keys(&keys).expect("sign");
        let card = KanbanCard::from_event(&event).expect("parse");
        assert_eq!(card.column, KanbanColumn::Doing);
        assert_eq!(card.position, 2.5);
        assert_eq!(card.title, "Ship it");
        assert_eq!(card.description, "the description");
    }

    #[test]
    fn tombstone_builds_without_title() {
        let builder = build_card(
            Uuid::parse_str(CHAN).unwrap(),
            Uuid::parse_str(CARD).unwrap(),
            KanbanColumn::Todo,
            0.0,
            "",
            "",
            None,
            None,
            true,
        )
        .expect("build tombstone");
        let keys = Keys::generate();
        let event = builder.sign_with_keys(&keys).expect("sign");
        let card = KanbanCard::from_event(&event).expect("parse");
        assert!(card.deleted);
    }
}
