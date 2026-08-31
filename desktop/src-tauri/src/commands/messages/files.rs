//! NIP-FS channel file entries — list and publish `kind:1063` events.
//!
//! The blob is uploaded through the existing media path first (`upload_media_*`);
//! `publish_channel_file` only records the resulting descriptor as a
//! channel-scoped event. Deletion reuses the shared `delete_message` command
//! (NIP-09 `kind:5`).

use nostr::{EventBuilder, Kind, Tag};
use tauri::State;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    events::check_content,
    models::{ChannelFileInfo, ChannelFilesResponse},
    relay::{query_relay, submit_event},
};

/// Build a `kind:1063` NIP-FS channel file entry. `description` is the event
/// content (may be empty); the blob is uploaded via the media path first, this
/// only records where it lives. Tag layout comes from
/// `buzz_core_pkg::file_entry` so this builder and the relay-side validator
/// cannot drift.
fn build_channel_file(
    channel_id: Uuid,
    description: &str,
    url: &str,
    sha256: &str,
    mime: &str,
    size: u64,
    name: &str,
) -> Result<EventBuilder, String> {
    check_content(description)?;
    let entry = buzz_core_pkg::file_entry::FileEntry {
        channel_id,
        url: url.to_string(),
        sha256: sha256.to_string(),
        mime: mime.to_string(),
        size,
        name: name.to_string(),
        version: 1,
        replaces: None,
        description: description.to_string(),
    };
    let tags = entry
        .to_tag_rows()
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("invalid file tag: {e}"))?;
    Ok(EventBuilder::new(Kind::Custom(1063), description).tags(tags))
}

/// First value of the first tag named `name`, if present.
fn first_tag_value(event: &nostr::Event, name: &str) -> Option<String> {
    event.tags.iter().find_map(|tag| {
        let slice = tag.as_slice();
        if slice.first().map(String::as_str) == Some(name) {
            slice.get(1).cloned()
        } else {
            None
        }
    })
}

/// Convert a raw `kind:1063` event to [`ChannelFileInfo`]. Events missing a
/// required NIP-FS tag are skipped by returning `None`.
fn file_info_from_event(event: &nostr::Event, channel_id: &str) -> Option<ChannelFileInfo> {
    let url = first_tag_value(event, "url")?;
    let sha256 = first_tag_value(event, "x")?;
    let mime = first_tag_value(event, "m")?;
    let size = first_tag_value(event, "size")?.parse().ok()?;
    let name = first_tag_value(event, "name")?;
    let version = first_tag_value(event, "v")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);

    Some(ChannelFileInfo {
        event_id: event.id.to_hex(),
        pubkey: event.pubkey.to_hex(),
        sig: event.sig.to_string(),
        url,
        sha256,
        mime,
        size,
        name,
        version,
        description: event.content.clone(),
        created_at: event.created_at.as_secs() as i64,
        channel_id: channel_id.to_string(),
    })
}

/// List the files uploaded to a channel, newest first.
#[tauri::command]
pub async fn get_channel_files(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<ChannelFilesResponse, String> {
    let filter = serde_json::json!({
        "kinds": [1063],
        "#h": [channel_id.clone()],
        "limit": 500,
    });

    let mut events = query_relay(&state, &[filter]).await?;
    events.sort_by_key(|event| std::cmp::Reverse(event.created_at.as_secs()));

    let files = events
        .iter()
        .filter_map(|event| file_info_from_event(event, &channel_id))
        .collect();

    Ok(ChannelFilesResponse { files })
}

/// Publish a `kind:1063` file entry for an already-uploaded blob.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn publish_channel_file(
    channel_id: String,
    url: String,
    sha256: String,
    mime: String,
    size: u64,
    name: String,
    description: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let channel_uuid =
        Uuid::parse_str(&channel_id).map_err(|_| format!("invalid channel UUID: {channel_id}"))?;

    let builder = build_channel_file(
        channel_uuid,
        description.as_deref().unwrap_or(""),
        &url,
        &sha256,
        &mime,
        size,
        &name,
    )?;

    let response = submit_event(builder, &state).await?;
    Ok(response.event_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn file_event(tags: &[[&str; 2]]) -> nostr::Event {
        let keys = Keys::generate();
        EventBuilder::new(Kind::Custom(1063), "a deck")
            .tags(
                tags.iter()
                    .map(|pair| Tag::parse(pair.to_vec()).expect("tag")),
            )
            .sign_with_keys(&keys)
            .expect("sign")
    }

    const CHAN: &str = "6f9d2c1e-1b7a-4a2e-9f3c-2b8e5d4a1c00";

    #[test]
    fn parses_a_complete_file_entry() {
        let event = file_event(&[
            ["h", CHAN],
            ["url", "https://relay.example/media/x.pdf"],
            [
                "x",
                "9f8a3c2b1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90",
            ],
            ["m", "application/pdf"],
            ["size", "184320"],
            ["name", "q3-planning.pdf"],
            ["v", "2"],
        ]);

        let info = file_info_from_event(&event, CHAN).expect("info");
        assert_eq!(info.name, "q3-planning.pdf");
        assert_eq!(info.size, 184_320);
        assert_eq!(info.mime, "application/pdf");
        assert_eq!(info.version, 2);
        assert_eq!(info.description, "a deck");
        assert_eq!(info.channel_id, CHAN);
    }

    #[test]
    fn version_defaults_to_one_when_absent() {
        let event = file_event(&[
            ["url", "https://relay.example/media/x.png"],
            [
                "x",
                "9f8a3c2b1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90",
            ],
            ["m", "image/png"],
            ["size", "10"],
            ["name", "x.png"],
        ]);
        assert_eq!(file_info_from_event(&event, CHAN).expect("info").version, 1);
    }

    #[test]
    fn skips_entry_missing_a_required_tag() {
        let event = file_event(&[
            ["url", "https://relay.example/media/x.png"],
            ["m", "image/png"],
            ["size", "10"],
            ["name", "x.png"],
        ]);
        assert!(file_info_from_event(&event, CHAN).is_none());
    }
}
