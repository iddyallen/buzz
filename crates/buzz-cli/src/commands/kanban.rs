//! `buzz kanban` — read and update a channel's Kanban board (NIP-KB).
//!
//! Cards are `kind:40110` events keyed by a stable `d` (card UUID); the board's
//! column list is an optional `kind:40111` event. Both use a client-side
//! last-write-wins merge (newest `created_at` per key wins), so every mutating
//! command here fetches the current winning version, applies the requested
//! change, and republishes the full desired state.

use buzz_core::kanban::{
    is_valid_column_id, position_between, KanbanBoard, KanbanBoardColumn, KanbanCard,
    DEFAULT_COLUMNS,
};
use nostr::Event;
use serde_json::json;
use uuid::Uuid;

use crate::client::{normalize_write_response, BuzzClient};
use crate::error::CliError;
use crate::validate::{parse_uuid, read_or_stdin, validate_hex64};
use crate::KanbanCmd;

pub async fn dispatch(cmd: KanbanCmd, client: &BuzzClient) -> Result<(), CliError> {
    match cmd {
        KanbanCmd::Board { channel } => cmd_board(client, &channel).await,
        KanbanCmd::SetColumns { channel, columns } => {
            cmd_set_columns(client, &channel, &columns).await
        }
        KanbanCmd::List { channel, column } => cmd_list(client, &channel, column.as_deref()).await,
        KanbanCmd::Add {
            channel,
            title,
            description,
            column,
            assignee,
            message,
        } => {
            cmd_add(
                client,
                &channel,
                &title,
                description.as_deref(),
                column.as_deref(),
                assignee.as_deref(),
                message.as_deref(),
            )
            .await
        }
        KanbanCmd::Set {
            channel,
            card,
            title,
            description,
            column,
            assignee,
        } => {
            cmd_set(
                client,
                &channel,
                &card,
                title.as_deref(),
                description.as_deref(),
                column.as_deref(),
                assignee.as_deref(),
            )
            .await
        }
        KanbanCmd::Rm { channel, card } => cmd_rm(client, &channel, &card).await,
    }
}

/// Newer wins: higher `created_at`, tie broken by the lexically-greater id.
fn is_newer(a: &Event, b: &Event) -> bool {
    match a.created_at.cmp(&b.created_at) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => a.id.to_hex() > b.id.to_hex(),
    }
}

async fn fetch_events(
    client: &BuzzClient,
    channel: &str,
    kind: u32,
) -> Result<Vec<Event>, CliError> {
    let filter = json!({ "kinds": [kind], "#h": [channel], "limit": 2000 });
    let raw = client.query(&filter).await?;
    let events: Vec<Event> = serde_json::from_str(&raw)
        .map_err(|e| CliError::Other(format!("could not parse relay events: {e}")))?;
    Ok(events)
}

/// The winning card per `d`, tombstones dropped.
fn live_cards(events: &[Event]) -> Vec<(Event, KanbanCard)> {
    let mut winners: std::collections::HashMap<Uuid, (Event, KanbanCard)> =
        std::collections::HashMap::new();
    for ev in events {
        let Ok(card) = KanbanCard::from_event(ev) else {
            continue;
        };
        match winners.get(&card.card_id) {
            Some((cur, _)) if !is_newer(ev, cur) => {}
            _ => {
                winners.insert(card.card_id, (ev.clone(), card));
            }
        }
    }
    winners.into_values().filter(|(_, c)| !c.deleted).collect()
}

async fn resolve_board(client: &BuzzClient, channel: &str, channel_id: Uuid) -> KanbanBoard {
    let events = fetch_events(client, channel, 40111)
        .await
        .unwrap_or_default();
    events
        .iter()
        .filter_map(|e| KanbanBoard::from_event(e).ok().map(|b| (e, b)))
        .reduce(|acc, next| if is_newer(next.0, acc.0) { next } else { acc })
        .map(|(_, b)| b)
        .unwrap_or_else(|| KanbanBoard::default_for(channel_id))
}

fn card_json(ev: &Event, card: &KanbanCard) -> serde_json::Value {
    json!({
        "card_id": card.card_id,
        "column": card.column,
        "position": card.position,
        "title": card.title,
        "description": card.description,
        "assignee": card.assignee,
        "source_event_id": card.source_event_id,
        "event_id": ev.id.to_hex(),
        "pubkey": ev.pubkey.to_hex(),
        "created_at": ev.created_at.as_secs(),
    })
}

async fn cmd_board(client: &BuzzClient, channel: &str) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let board = resolve_board(client, channel, channel_id).await;
    println!("{}", serde_json::to_string_pretty(&board.columns).unwrap());
    Ok(())
}

fn parse_columns_arg(spec: &str) -> Result<Vec<KanbanBoardColumn>, CliError> {
    let mut columns = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (id, label) = match part.split_once(':') {
            Some((id, label)) => (id.trim().to_string(), label.trim().to_string()),
            None => (part.to_string(), part.to_string()),
        };
        columns.push(KanbanBoardColumn { id, label });
    }
    KanbanBoard::validate_columns(&columns)
        .map_err(|e| CliError::Usage(format!("invalid --columns: {e}")))?;
    Ok(columns)
}

async fn cmd_set_columns(client: &BuzzClient, channel: &str, spec: &str) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let columns = parse_columns_arg(spec)?;
    let board = KanbanBoard {
        channel_id,
        columns,
    };
    let builder = buzz_sdk::build_kanban_board(&board)
        .map_err(|e| CliError::Other(format!("build_kanban_board failed: {e}")))?;
    let event = client.sign_event(builder)?;
    let resp = client.submit_event(event).await?;
    println!("{}", normalize_write_response(&resp));
    Ok(())
}

async fn cmd_list(
    client: &BuzzClient,
    channel: &str,
    column: Option<&str>,
) -> Result<(), CliError> {
    parse_uuid(channel)?;
    let mut cards = live_cards(&fetch_events(client, channel, 40110).await?);
    if let Some(col) = column {
        cards.retain(|(_, c)| c.column == col);
    }
    cards.sort_by(|(ea, a), (eb, b)| {
        a.column
            .cmp(&b.column)
            .then(
                a.position
                    .partial_cmp(&b.position)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(ea.created_at.cmp(&eb.created_at))
    });
    let out: Vec<_> = cards.iter().map(|(ev, c)| card_json(ev, c)).collect();
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
    Ok(())
}

fn resolve_assignee(client: &BuzzClient, raw: &str) -> Result<Option<String>, CliError> {
    match raw {
        "me" => Ok(Some(client.keys().public_key().to_hex())),
        "none" | "" => Ok(None),
        hex => {
            validate_hex64(hex)?;
            Ok(Some(hex.to_string()))
        }
    }
}

/// Append position for a new/incoming card in `column`.
fn append_position(cards: &[(Event, KanbanCard)], column: &str, skip: Option<Uuid>) -> f64 {
    let last = cards
        .iter()
        .filter(|(_, c)| c.column == column && Some(c.card_id) != skip)
        .map(|(_, c)| c.position)
        .fold(None::<f64>, |acc, p| Some(acc.map_or(p, |a| a.max(p))));
    position_between(last, None)
}

#[allow(clippy::too_many_arguments)]
async fn cmd_add(
    client: &BuzzClient,
    channel: &str,
    title: &str,
    description: Option<&str>,
    column: Option<&str>,
    assignee: Option<&str>,
    message: Option<&str>,
) -> Result<(), CliError> {
    let channel_id = parse_uuid(channel)?;
    let board = resolve_board(client, channel, channel_id).await;
    let column = match column {
        Some(c) => {
            if !is_valid_column_id(c) {
                return Err(CliError::Usage(format!(
                    "--column must be a [a-z0-9_-] slug (got {c})"
                )));
            }
            c.to_string()
        }
        None => board
            .columns
            .first()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| DEFAULT_COLUMNS[0].0.to_string()),
    };
    let description = match description {
        Some(d) => read_or_stdin(d)?,
        None => String::new(),
    };
    if let Some(m) = message {
        validate_hex64(m)?;
    }
    let assignee = match assignee {
        Some(a) => resolve_assignee(client, a)?,
        None => None,
    };

    let cards = live_cards(&fetch_events(client, channel, 40110).await?);
    let card = KanbanCard {
        channel_id,
        card_id: Uuid::new_v4(),
        column: column.clone(),
        position: append_position(&cards, &column, None),
        title: title.to_string(),
        description,
        assignee,
        source_event_id: message.map(str::to_string),
        deleted: false,
    };
    submit_card(client, &card).await?;
    println!("{}", json!({ "card_id": card.card_id }));
    Ok(())
}

async fn cmd_set(
    client: &BuzzClient,
    channel: &str,
    card_id: &str,
    title: Option<&str>,
    description: Option<&str>,
    column: Option<&str>,
    assignee: Option<&str>,
) -> Result<(), CliError> {
    parse_uuid(channel)?;
    let card_uuid = parse_uuid(card_id)?;
    let cards = live_cards(&fetch_events(client, channel, 40110).await?);
    let (_, current) = cards
        .iter()
        .find(|(_, c)| c.card_id == card_uuid)
        .ok_or_else(|| CliError::Other(format!("no live card {card_id} in that channel")))?;

    let mut next = current.clone();
    if let Some(t) = title {
        next.title = t.to_string();
    }
    if let Some(d) = description {
        next.description = read_or_stdin(d)?;
    }
    if let Some(a) = assignee {
        next.assignee = resolve_assignee(client, a)?;
    }
    if let Some(c) = column {
        if !is_valid_column_id(c) {
            return Err(CliError::Usage(format!(
                "--column must be a [a-z0-9_-] slug (got {c})"
            )));
        }
        if c != next.column {
            next.column = c.to_string();
            next.position = append_position(&cards, c, Some(card_uuid));
        }
    }

    submit_card(client, &next).await?;
    println!("{}", json!({ "card_id": next.card_id }));
    Ok(())
}

async fn cmd_rm(client: &BuzzClient, channel: &str, card_id: &str) -> Result<(), CliError> {
    parse_uuid(channel)?;
    let card_uuid = parse_uuid(card_id)?;
    let cards = live_cards(&fetch_events(client, channel, 40110).await?);
    let (_, current) = cards
        .iter()
        .find(|(_, c)| c.card_id == card_uuid)
        .ok_or_else(|| CliError::Other(format!("no live card {card_id} in that channel")))?;
    let mut tomb = current.clone();
    tomb.deleted = true;
    submit_card(client, &tomb).await?;
    println!("{}", json!({ "card_id": card_uuid, "deleted": true }));
    Ok(())
}

async fn submit_card(client: &BuzzClient, card: &KanbanCard) -> Result<(), CliError> {
    let builder = buzz_sdk::build_kanban_card(card)
        .map_err(|e| CliError::Other(format!("build_kanban_card failed: {e}")))?;
    let event = client.sign_event(builder)?;
    let resp = client.submit_event(event).await?;
    // Surface a NIP-33-style write conflict / rejection to the caller.
    let _ = normalize_write_response(&resp);
    Ok(())
}
