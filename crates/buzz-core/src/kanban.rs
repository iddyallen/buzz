//! NIP-KB: Kanban Board — channel-scoped `kind:40110` task cards.
//!
//! A Kanban card lives inside a Buzz channel as a `kind:40110` event scoped to
//! that channel by an `h` tag and identified by a stable `d` tag (the card
//! UUID). The kind is a **regular** event, not a replaceable one: every
//! create, edit, and move is a fresh event, and clients keep only the highest
//! `created_at` per `d` (last-write-wins across all authors). A card is
//! retracted by a `["deleted", "true"]` tag on a newer version, or by an
//! ordinary NIP-09 `kind:5` deletion.
//!
//! Columns are the fixed set `todo` / `doing` / `done`. Ordering within a
//! column is a fractional `pos` tag ([`position_between`]) so dragging a card
//! rewrites only the moved card, never the whole column.
//!
//! This module parses such an event into a [`KanbanCard`], validates the
//! NIP-KB tag contract, and builds the tag list for publishing one. See
//! `docs/nips/NIP-KB.md` for the full specification.

use nostr::Event;
use uuid::Uuid;

use crate::kind::{event_kind_u32, KIND_KANBAN_CARD};

/// Marker used on the `e` tag that links a card back to the message it was
/// created from.
pub const SOURCE_MARKER: &str = "source";

/// Maximum length of the card `title`, in characters, after trimming.
pub const MAX_TITLE_LEN: usize = 200;

/// Maximum length of the card description (`content`), in characters.
pub const MAX_DESCRIPTION_LEN: usize = 20_000;

/// Spacing applied when appending a card to a column end (see
/// [`position_between`]).
pub const POSITION_STEP: f64 = 1.0;

/// The fixed set of Kanban columns. NIP-KB v1 does not support custom columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum KanbanColumn {
    /// Not started.
    Todo,
    /// In progress.
    Doing,
    /// Finished.
    Done,
}

impl KanbanColumn {
    /// Every column, in board order.
    pub const ALL: [KanbanColumn; 3] =
        [KanbanColumn::Todo, KanbanColumn::Doing, KanbanColumn::Done];

    /// The wire token for the `col` tag.
    pub fn as_str(self) -> &'static str {
        match self {
            KanbanColumn::Todo => "todo",
            KanbanColumn::Doing => "doing",
            KanbanColumn::Done => "done",
        }
    }

    /// Parse a `col` tag token. Returns `None` for any value outside the fixed
    /// set.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "todo" => Some(KanbanColumn::Todo),
            "doing" => Some(KanbanColumn::Doing),
            "done" => Some(KanbanColumn::Done),
            _ => None,
        }
    }
}

/// Why parsing or validating a `kind:40110` Kanban card failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KanbanCardError {
    /// Event kind was not [`KIND_KANBAN_CARD`].
    #[error("wrong kind: expected {expected}, got {got}")]
    WrongKind {
        /// Expected kind (40110).
        expected: u32,
        /// Kind actually present on the event.
        got: u32,
    },
    /// A REQUIRED tag was absent.
    #[error("missing required tag: {0}")]
    MissingTag(&'static str),
    /// The `h` tag was not a valid UUID.
    #[error("invalid channel id in `h` tag: {0}")]
    InvalidChannelId(String),
    /// The `d` tag was not a valid UUID.
    #[error("invalid card id in `d` tag: {0}")]
    InvalidCardId(String),
    /// The `col` tag was not one of `todo` / `doing` / `done`.
    #[error("invalid `col` tag: {0}")]
    InvalidColumn(String),
    /// The `pos` tag was not a finite base-10 float.
    #[error("invalid `pos` tag: must be a finite number")]
    InvalidPosition,
    /// The `title` tag violated the character or length rule.
    #[error("invalid `title` tag: {0}")]
    InvalidTitle(&'static str),
    /// The description (`content`) exceeded [`MAX_DESCRIPTION_LEN`].
    #[error("description exceeds {MAX_DESCRIPTION_LEN} characters")]
    DescriptionTooLong,
    /// The `p` (assignee) tag was not 64 lowercase hex characters.
    #[error("invalid `p` (assignee) tag: must be 64 lowercase hex chars")]
    InvalidAssignee,
    /// The `e` (source message) tag was not 64 lowercase hex characters.
    #[error("invalid `e` (source) tag: must be 64 lowercase hex chars")]
    InvalidSource,
    /// A `deleted` tag was present with a value other than `"true"`.
    #[error("invalid `deleted` tag: the only accepted value is \"true\"")]
    InvalidDeleted,
}

/// A parsed, validated NIP-KB Kanban card.
#[derive(Debug, Clone, PartialEq)]
pub struct KanbanCard {
    /// Channel the card belongs to (`h` tag).
    pub channel_id: Uuid,
    /// Stable card identity across versions (`d` tag).
    pub card_id: Uuid,
    /// Which column the card currently sits in (`col` tag).
    pub column: KanbanColumn,
    /// Fractional sort key within the column (`pos` tag).
    pub position: f64,
    /// Card title (`title` tag); may be empty only on a tombstone.
    pub title: String,
    /// Free-form description (`content`); may be empty.
    pub description: String,
    /// Assignee public key, lowercase hex (`p` tag), if any. NIP-KB v1 does not
    /// distinguish a human assignee from an agent — this is just a pubkey.
    pub assignee: Option<String>,
    /// Id of the `kind:9` message this card was created from (`e` tag with the
    /// `source` marker), if any.
    pub source_event_id: Option<String>,
    /// `true` when this version retracts the card (`["deleted", "true"]`).
    pub deleted: bool,
}

fn first_tag_value<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    event.tags.iter().find_map(|tag| {
        let s = tag.as_slice();
        if s.first().map(String::as_str) == Some(name) {
            s.get(1).map(String::as_str)
        } else {
            None
        }
    })
}

fn is_valid_event_id_hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn validate_title(raw: &str, deleted: bool) -> Result<String, KanbanCardError> {
    let title = raw.trim();
    if title.contains('\0') {
        return Err(KanbanCardError::InvalidTitle("must not contain NUL"));
    }
    if title.chars().count() > MAX_TITLE_LEN {
        return Err(KanbanCardError::InvalidTitle("exceeds 200 characters"));
    }
    if title.is_empty() && !deleted {
        return Err(KanbanCardError::InvalidTitle("must not be empty"));
    }
    Ok(title.to_string())
}

impl KanbanCard {
    /// Parse and validate a `kind:40110` event as a NIP-KB Kanban card.
    pub fn from_event(event: &Event) -> Result<Self, KanbanCardError> {
        let got = event_kind_u32(event);
        if got != KIND_KANBAN_CARD {
            return Err(KanbanCardError::WrongKind {
                expected: KIND_KANBAN_CARD,
                got,
            });
        }

        let h = first_tag_value(event, "h").ok_or(KanbanCardError::MissingTag("h"))?;
        let channel_id =
            Uuid::parse_str(h).map_err(|_| KanbanCardError::InvalidChannelId(h.to_string()))?;

        let d = first_tag_value(event, "d").ok_or(KanbanCardError::MissingTag("d"))?;
        let card_id =
            Uuid::parse_str(d).map_err(|_| KanbanCardError::InvalidCardId(d.to_string()))?;

        let col = first_tag_value(event, "col").ok_or(KanbanCardError::MissingTag("col"))?;
        let column = KanbanColumn::parse(col)
            .ok_or_else(|| KanbanCardError::InvalidColumn(col.to_string()))?;

        let pos_raw = first_tag_value(event, "pos").ok_or(KanbanCardError::MissingTag("pos"))?;
        let position: f64 = pos_raw
            .parse()
            .ok()
            .filter(|n: &f64| n.is_finite())
            .ok_or(KanbanCardError::InvalidPosition)?;

        let deleted = match Self::deleted_tag_value(event) {
            None => false,
            Some("true") => true,
            Some(_) => return Err(KanbanCardError::InvalidDeleted),
        };

        let title_raw =
            first_tag_value(event, "title").ok_or(KanbanCardError::MissingTag("title"))?;
        let title = validate_title(title_raw, deleted)?;

        if event.content.chars().count() > MAX_DESCRIPTION_LEN {
            return Err(KanbanCardError::DescriptionTooLong);
        }

        let assignee = match first_tag_value(event, "p") {
            None => None,
            Some(p) if is_valid_event_id_hex(p) => Some(p.to_string()),
            Some(_) => return Err(KanbanCardError::InvalidAssignee),
        };

        let source_event_id = event.tags.iter().find_map(|tag| {
            let s = tag.as_slice();
            if s.first().map(String::as_str) == Some("e")
                && s.get(3).map(String::as_str) == Some(SOURCE_MARKER)
            {
                s.get(1).map(String::as_str)
            } else {
                None
            }
        });
        let source_event_id = match source_event_id {
            None => None,
            Some(e) if is_valid_event_id_hex(e) => Some(e.to_string()),
            Some(_) => return Err(KanbanCardError::InvalidSource),
        };

        Ok(KanbanCard {
            channel_id,
            card_id,
            column,
            position,
            title,
            description: event.content.clone(),
            assignee,
            source_event_id,
            deleted,
        })
    }

    fn deleted_tag_value(event: &Event) -> Option<&str> {
        event.tags.iter().find_map(|tag| {
            let s = tag.as_slice();
            if s.first().map(String::as_str) == Some("deleted") {
                Some(s.get(1).map(String::as_str).unwrap_or(""))
            } else {
                None
            }
        })
    }

    /// Build the tag list for a `kind:40110` Kanban card event.
    ///
    /// The returned rows are ready to hand to `nostr::EventBuilder::tags` after
    /// mapping through `nostr::Tag::parse`. `content` carries the description.
    pub fn to_tag_rows(&self) -> Vec<Vec<String>> {
        let mut rows = vec![
            vec!["h".to_string(), self.channel_id.to_string()],
            vec!["d".to_string(), self.card_id.to_string()],
            vec!["col".to_string(), self.column.as_str().to_string()],
            vec!["pos".to_string(), format_position(self.position)],
            vec!["title".to_string(), self.title.clone()],
        ];
        if let Some(p) = &self.assignee {
            rows.push(vec!["p".to_string(), p.clone()]);
        }
        if let Some(e) = &self.source_event_id {
            rows.push(vec![
                "e".to_string(),
                e.clone(),
                String::new(),
                SOURCE_MARKER.to_string(),
            ]);
        }
        if self.deleted {
            rows.push(vec!["deleted".to_string(), "true".to_string()]);
        }
        rows
    }
}

/// Render a position as a compact, round-trippable decimal string.
///
/// `{}` on an `f64` already avoids scientific notation for the magnitudes a
/// board produces and drops trailing zeros (`1.0` → `"1"`), so parsing the
/// result back yields the same value.
pub fn format_position(pos: f64) -> String {
    format!("{pos}")
}

/// Pick a fractional position that sorts strictly between `before` and `after`.
///
/// Pass the `position` of the card that should end up immediately before the
/// moved card as `before`, and the one immediately after as `after`; pass
/// `None` for a column end. Appending to an empty column yields `0.0`.
///
/// The midpoint can only be subdivided so many times before two `f64`s become
/// indistinguishable; callers that move the same gap thousands of times should
/// periodically renumber the column with evenly spaced integers.
pub fn position_between(before: Option<f64>, after: Option<f64>) -> f64 {
    match (before, after) {
        (None, None) => 0.0,
        (Some(b), None) => b + POSITION_STEP,
        (None, Some(a)) => a - POSITION_STEP,
        (Some(b), Some(a)) => b + (a - b) / 2.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    const CHAN: &str = "6f9d2c1e-1b7a-4a2e-9f3c-2b8e5d4a1c00";
    const CARD: &str = "11111111-2222-3333-4444-555555555555";
    const HEX64: &str = "9f8a3c2b1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90";

    fn build(tags: &[&[&str]], content: &str) -> Event {
        let keys = Keys::generate();
        EventBuilder::new(Kind::Custom(KIND_KANBAN_CARD as u16), content)
            .tags(tags.iter().map(|t| Tag::parse(t.to_vec()).unwrap()))
            .sign_with_keys(&keys)
            .expect("sign")
    }

    fn valid_tags() -> Vec<Vec<&'static str>> {
        vec![
            vec!["h", CHAN],
            vec!["d", CARD],
            vec!["col", "doing"],
            vec!["pos", "1.5"],
            vec!["title", "Ship the board"],
        ]
    }

    fn parse_valid(extra: &[&[&str]]) -> Result<KanbanCard, KanbanCardError> {
        let owned = valid_tags();
        let mut rows: Vec<&[&str]> = owned.iter().map(|r| r.as_slice()).collect();
        rows.extend_from_slice(extra);
        KanbanCard::from_event(&build(&rows, "do the thing"))
    }

    #[test]
    fn parses_minimal_valid_card() {
        let card = parse_valid(&[]).expect("valid");
        assert_eq!(card.channel_id, Uuid::parse_str(CHAN).unwrap());
        assert_eq!(card.card_id, Uuid::parse_str(CARD).unwrap());
        assert_eq!(card.column, KanbanColumn::Doing);
        assert_eq!(card.position, 1.5);
        assert_eq!(card.title, "Ship the board");
        assert_eq!(card.description, "do the thing");
        assert_eq!(card.assignee, None);
        assert_eq!(card.source_event_id, None);
        assert!(!card.deleted);
    }

    #[test]
    fn wrong_kind_rejected() {
        let keys = Keys::generate();
        let ev = EventBuilder::new(Kind::Custom(1), "x")
            .sign_with_keys(&keys)
            .unwrap();
        assert!(matches!(
            KanbanCard::from_event(&ev),
            Err(KanbanCardError::WrongKind { got: 1, .. })
        ));
    }

    #[test]
    fn each_required_tag_is_enforced() {
        for missing in ["h", "d", "col", "pos", "title"] {
            let rows: Vec<Vec<&str>> = valid_tags()
                .into_iter()
                .filter(|r| r[0] != missing)
                .collect();
            let refs: Vec<&[&str]> = rows.iter().map(|r| r.as_slice()).collect();
            let err = KanbanCard::from_event(&build(&refs, "")).unwrap_err();
            assert_eq!(err, KanbanCardError::MissingTag(missing), "for {missing}");
        }
    }

    #[test]
    fn rejects_bad_scalar_tags() {
        assert_eq!(
            parse_valid_with_override("h", "not-a-uuid").unwrap_err(),
            KanbanCardError::InvalidChannelId("not-a-uuid".to_string())
        );
        assert_eq!(
            parse_valid_with_override("d", "nope").unwrap_err(),
            KanbanCardError::InvalidCardId("nope".to_string())
        );
        assert!(matches!(
            parse_valid_with_override("col", "backlog").unwrap_err(),
            KanbanCardError::InvalidColumn(_)
        ));
        assert_eq!(
            parse_valid_with_override("pos", "abc").unwrap_err(),
            KanbanCardError::InvalidPosition
        );
        assert_eq!(
            parse_valid_with_override("pos", "inf").unwrap_err(),
            KanbanCardError::InvalidPosition
        );
        assert_eq!(
            parse_valid_with_override("pos", "NaN").unwrap_err(),
            KanbanCardError::InvalidPosition
        );
    }

    #[test]
    fn negative_and_integer_positions_are_accepted() {
        assert_eq!(
            parse_valid_with_override("pos", "-3").unwrap().position,
            -3.0
        );
        assert_eq!(parse_valid_with_override("pos", "0").unwrap().position, 0.0);
    }

    fn parse_valid_with_override(key: &str, value: &str) -> Result<KanbanCard, KanbanCardError> {
        let rows: Vec<Vec<String>> = valid_tags()
            .into_iter()
            .map(|r| {
                if r[0] == key {
                    vec![r[0].to_string(), value.to_string()]
                } else {
                    r.iter().map(|s| s.to_string()).collect()
                }
            })
            .collect();
        let keys = Keys::generate();
        let ev = EventBuilder::new(Kind::Custom(KIND_KANBAN_CARD as u16), "")
            .tags(rows.iter().map(|r| Tag::parse(r.clone()).unwrap()))
            .sign_with_keys(&keys)
            .unwrap();
        KanbanCard::from_event(&ev)
    }

    #[test]
    fn empty_title_allowed_only_on_tombstone() {
        assert!(matches!(
            parse_valid_with_override("title", "   ").unwrap_err(),
            KanbanCardError::InvalidTitle(_)
        ));
        let ev = build(
            &[
                &["h", CHAN],
                &["d", CARD],
                &["col", "todo"],
                &["pos", "0"],
                &["title", ""],
                &["deleted", "true"],
            ],
            "",
        );
        let parsed = KanbanCard::from_event(&ev).expect("tombstone");
        assert!(parsed.deleted);
        assert_eq!(parsed.title, "");
    }

    #[test]
    fn title_length_capped() {
        let long = "x".repeat(MAX_TITLE_LEN + 1);
        assert!(matches!(
            parse_valid_with_override("title", &long).unwrap_err(),
            KanbanCardError::InvalidTitle(_)
        ));
    }

    #[test]
    fn description_length_capped() {
        let long = "x".repeat(MAX_DESCRIPTION_LEN + 1);
        let owned = valid_tags();
        let refs: Vec<&[&str]> = owned.iter().map(|r| r.as_slice()).collect();
        assert_eq!(
            KanbanCard::from_event(&build(&refs, &long)).unwrap_err(),
            KanbanCardError::DescriptionTooLong
        );
    }

    #[test]
    fn assignee_and_source_validated() {
        let card = parse_valid(&[&["p", HEX64], &["e", HEX64, "", "source"]]).unwrap();
        assert_eq!(card.assignee.as_deref(), Some(HEX64));
        assert_eq!(card.source_event_id.as_deref(), Some(HEX64));

        assert_eq!(
            parse_valid(&[&["p", "deadbeef"]]).unwrap_err(),
            KanbanCardError::InvalidAssignee
        );
        assert_eq!(
            parse_valid(&[&["e", "deadbeef", "", "source"]]).unwrap_err(),
            KanbanCardError::InvalidSource
        );
        // An `e` tag without the `source` marker is ignored, not rejected.
        assert!(parse_valid(&[&["e", "deadbeef"]]).is_ok());
    }

    #[test]
    fn deleted_tag_must_be_true() {
        assert_eq!(
            parse_valid(&[&["deleted", "false"]]).unwrap_err(),
            KanbanCardError::InvalidDeleted
        );
        assert!(parse_valid(&[&["deleted", "true"]]).unwrap().deleted);
    }

    #[test]
    fn tag_rows_round_trip_through_parse() {
        let original = parse_valid(&[&["p", HEX64], &["e", HEX64, "", "source"]]).unwrap();
        let keys = Keys::generate();
        let ev = EventBuilder::new(
            Kind::Custom(KIND_KANBAN_CARD as u16),
            original.description.clone(),
        )
        .tags(
            original
                .to_tag_rows()
                .into_iter()
                .map(|r| Tag::parse(r).unwrap()),
        )
        .sign_with_keys(&keys)
        .unwrap();
        assert_eq!(KanbanCard::from_event(&ev).unwrap(), original);
    }

    #[test]
    fn column_tokens_round_trip() {
        for col in KanbanColumn::ALL {
            assert_eq!(KanbanColumn::parse(col.as_str()), Some(col));
        }
        assert_eq!(KanbanColumn::parse("Done"), None);
    }

    #[test]
    fn position_between_orders_strictly() {
        assert_eq!(position_between(None, None), 0.0);
        assert_eq!(position_between(Some(4.0), None), 5.0);
        assert_eq!(position_between(None, Some(4.0)), 3.0);

        let mid = position_between(Some(1.0), Some(2.0));
        assert!(mid > 1.0 && mid < 2.0);

        let a = position_between(Some(1.0), Some(1.0000001));
        assert!(a > 1.0 && a < 1.0000001);
    }

    #[test]
    fn format_position_round_trips() {
        for v in [0.0, 1.0, -3.5, 1.5, 2.0000001, 123456.75] {
            assert_eq!(format_position(v).parse::<f64>().unwrap(), v);
        }
    }
}
