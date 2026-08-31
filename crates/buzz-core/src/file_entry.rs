//! NIP-FS: File Storage — channel-scoped `kind:1063` file entries.
//!
//! A file uploaded to a Buzz channel is a NIP-94 `kind:1063` event scoped to
//! that channel by an `h` tag. This module parses such an event into a
//! [`FileEntry`], validates the NIP-FS tag contract, and builds the tag list
//! for publishing one.
//!
//! See `docs/nips/NIP-FS.md` for the full specification.

use nostr::Event;
use uuid::Uuid;

use crate::kind::{event_kind_u32, KIND_FILE_METADATA};

/// Marker used on the `e` tag that links a version to the one it replaces.
pub const REPLACE_MARKER: &str = "replace";

/// Why parsing or validating a `kind:1063` file entry failed.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FileEntryError {
    /// Event kind was not [`KIND_FILE_METADATA`].
    #[error("wrong kind: expected {expected}, got {got}")]
    WrongKind {
        /// Expected kind (1063).
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
    /// The `url` tag was not an acceptable retrieval URL.
    #[error("invalid `url` tag: {0}")]
    InvalidUrl(String),
    /// The `x` tag was not 64 lowercase hex characters.
    #[error("invalid `x` (sha256) tag: must be 64 lowercase hex chars")]
    InvalidHash,
    /// The `m` tag was not a `type/subtype` MIME string.
    #[error("invalid `m` (mime) tag: {0}")]
    InvalidMime(String),
    /// The `size` tag was not a positive base-10 integer.
    #[error("invalid `size` tag: must be a positive base-10 integer")]
    InvalidSize,
    /// The `name` tag violated the character or length rule.
    #[error("invalid `name` tag: {0}")]
    InvalidName(&'static str),
    /// The `v` tag was present but not an integer `>= 1`.
    #[error("invalid `v` (version) tag: must be an integer >= 1")]
    InvalidVersion,
}

/// A parsed, validated NIP-FS file entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    /// Channel the file belongs to (`h` tag).
    pub channel_id: Uuid,
    /// Retrieval URL for the blob (`url` tag).
    pub url: String,
    /// Lowercase hex SHA-256 of the blob (`x` tag).
    pub sha256: String,
    /// MIME type (`m` tag).
    pub mime: String,
    /// Blob size in bytes (`size` tag).
    pub size: u64,
    /// Display file name (`name` tag).
    pub name: String,
    /// Version number (`v` tag); `1` when the tag is absent.
    pub version: u64,
    /// Event id of the version this entry replaces (`e` tag with `replace`
    /// marker), if any.
    pub replaces: Option<String>,
    /// Human-readable description (`content`); may be empty.
    pub description: String,
}

/// Maximum length of the `name` tag, in characters, after trimming.
pub const MAX_NAME_LEN: usize = 255;

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

fn is_valid_sha256_hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn is_valid_mime(s: &str) -> bool {
    match s.split_once('/') {
        Some((t, sub)) => {
            !t.is_empty()
                && !sub.is_empty()
                && !t.contains(char::is_whitespace)
                && !sub.contains(char::is_whitespace)
        }
        None => false,
    }
}

fn validate_name(raw: &str) -> Result<String, FileEntryError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(FileEntryError::InvalidName("must not be empty"));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(FileEntryError::InvalidName("exceeds 255 characters"));
    }
    if name.contains(['/', '\\', '\0']) {
        return Err(FileEntryError::InvalidName(
            "must not contain '/', '\\', or NUL",
        ));
    }
    Ok(name.to_string())
}

fn validate_url(s: &str) -> Result<(), FileEntryError> {
    let is_https = s.starts_with("https://");
    let is_loopback_http = s.starts_with("http://127.0.0.1")
        || s.starts_with("http://localhost")
        || s.starts_with("http://[::1]");
    if is_https || is_loopback_http {
        Ok(())
    } else {
        Err(FileEntryError::InvalidUrl(
            "must be https:// (or http:// for loopback dev relays)".to_string(),
        ))
    }
}

impl FileEntry {
    /// Parse and validate a `kind:1063` event as a NIP-FS file entry.
    pub fn from_event(event: &Event) -> Result<Self, FileEntryError> {
        let got = event_kind_u32(event);
        if got != KIND_FILE_METADATA {
            return Err(FileEntryError::WrongKind {
                expected: KIND_FILE_METADATA,
                got,
            });
        }

        let h = first_tag_value(event, "h").ok_or(FileEntryError::MissingTag("h"))?;
        let channel_id =
            Uuid::parse_str(h).map_err(|_| FileEntryError::InvalidChannelId(h.to_string()))?;

        let url = first_tag_value(event, "url").ok_or(FileEntryError::MissingTag("url"))?;
        validate_url(url)?;

        let sha256 = first_tag_value(event, "x").ok_or(FileEntryError::MissingTag("x"))?;
        if !is_valid_sha256_hex(sha256) {
            return Err(FileEntryError::InvalidHash);
        }

        let mime = first_tag_value(event, "m").ok_or(FileEntryError::MissingTag("m"))?;
        if !is_valid_mime(mime) {
            return Err(FileEntryError::InvalidMime(mime.to_string()));
        }

        let size_raw = first_tag_value(event, "size").ok_or(FileEntryError::MissingTag("size"))?;
        let size: u64 = size_raw
            .parse()
            .ok()
            .filter(|n| *n > 0)
            .ok_or(FileEntryError::InvalidSize)?;

        let name_raw = first_tag_value(event, "name").ok_or(FileEntryError::MissingTag("name"))?;
        let name = validate_name(name_raw)?;

        let version = match first_tag_value(event, "v") {
            None => 1,
            Some(v) => v
                .parse()
                .ok()
                .filter(|n| *n >= 1)
                .ok_or(FileEntryError::InvalidVersion)?,
        };

        let replaces = event.tags.iter().find_map(|tag| {
            let s = tag.as_slice();
            if s.first().map(String::as_str) == Some("e")
                && s.get(3).map(String::as_str) == Some(REPLACE_MARKER)
            {
                s.get(1).map(String::as_str).map(str::to_string)
            } else {
                None
            }
        });

        Ok(FileEntry {
            channel_id,
            url: url.to_string(),
            sha256: sha256.to_string(),
            mime: mime.to_string(),
            size,
            name,
            version,
            replaces,
            description: event.content.clone(),
        })
    }

    /// Build the tag list for a `kind:1063` file-entry event.
    ///
    /// The returned rows are ready to hand to `nostr::EventBuilder::tags` after
    /// mapping through `nostr::Tag::parse`. `content` carries the description.
    pub fn to_tag_rows(&self) -> Vec<Vec<String>> {
        let mut rows = vec![
            vec!["h".to_string(), self.channel_id.to_string()],
            vec!["url".to_string(), self.url.clone()],
            vec!["x".to_string(), self.sha256.clone()],
            vec!["m".to_string(), self.mime.clone()],
            vec!["size".to_string(), self.size.to_string()],
            vec!["name".to_string(), self.name.clone()],
            vec!["v".to_string(), self.version.to_string()],
        ];
        if let Some(prev) = &self.replaces {
            rows.push(vec![
                "e".to_string(),
                prev.clone(),
                String::new(),
                REPLACE_MARKER.to_string(),
            ]);
        }
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn build(tags: &[&[&str]], content: &str) -> Event {
        let keys = Keys::generate();
        EventBuilder::new(Kind::Custom(KIND_FILE_METADATA as u16), content)
            .tags(tags.iter().map(|t| Tag::parse(t.to_vec()).unwrap()))
            .sign_with_keys(&keys)
            .expect("sign")
    }

    const CHAN: &str = "6f9d2c1e-1b7a-4a2e-9f3c-2b8e5d4a1c00";
    const HASH: &str = "9f8a3c2b1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90";
    const URL: &str = "https://relay.example/media/blob.pdf";

    fn valid_tags() -> Vec<Vec<&'static str>> {
        vec![
            vec!["h", CHAN],
            vec!["url", URL],
            vec!["x", HASH],
            vec!["m", "application/pdf"],
            vec!["size", "184320"],
            vec!["name", "q3-planning.pdf"],
        ]
    }

    fn parse_valid(extra: &[&[&str]]) -> Result<FileEntry, FileEntryError> {
        let owned = valid_tags();
        let mut rows: Vec<&[&str]> = owned.iter().map(|r| r.as_slice()).collect();
        rows.extend_from_slice(extra);
        FileEntry::from_event(&build(&rows, "a deck"))
    }

    #[test]
    fn parses_minimal_valid_entry() {
        let entry = parse_valid(&[]).expect("valid");
        assert_eq!(entry.channel_id, Uuid::parse_str(CHAN).unwrap());
        assert_eq!(entry.url, URL);
        assert_eq!(entry.sha256, HASH);
        assert_eq!(entry.mime, "application/pdf");
        assert_eq!(entry.size, 184_320);
        assert_eq!(entry.name, "q3-planning.pdf");
        assert_eq!(entry.version, 1);
        assert_eq!(entry.replaces, None);
        assert_eq!(entry.description, "a deck");
    }

    #[test]
    fn wrong_kind_rejected() {
        let keys = Keys::generate();
        let ev = EventBuilder::new(Kind::Custom(1), "x")
            .tags([])
            .sign_with_keys(&keys)
            .unwrap();
        assert!(matches!(
            FileEntry::from_event(&ev),
            Err(FileEntryError::WrongKind { got: 1, .. })
        ));
    }

    #[test]
    fn each_required_tag_is_enforced() {
        for missing in ["h", "url", "x", "m", "size", "name"] {
            let rows: Vec<Vec<&str>> = valid_tags()
                .into_iter()
                .filter(|r| r[0] != missing)
                .collect();
            let refs: Vec<&[&str]> = rows.iter().map(|r| r.as_slice()).collect();
            let err = FileEntry::from_event(&build(&refs, "")).unwrap_err();
            assert_eq!(err, FileEntryError::MissingTag(missing), "for {missing}");
        }
    }

    #[test]
    fn rejects_bad_hash_mime_size_url() {
        assert_eq!(
            parse_valid_with_override("x", "deadbeef").unwrap_err(),
            FileEntryError::InvalidHash
        );
        assert_eq!(
            parse_valid_with_override("x", &HASH.to_uppercase()).unwrap_err(),
            FileEntryError::InvalidHash
        );
        assert_eq!(
            parse_valid_with_override("size", "0").unwrap_err(),
            FileEntryError::InvalidSize
        );
        assert_eq!(
            parse_valid_with_override("size", "-4").unwrap_err(),
            FileEntryError::InvalidSize
        );
        assert!(matches!(
            parse_valid_with_override("m", "pdf").unwrap_err(),
            FileEntryError::InvalidMime(_)
        ));
        assert!(matches!(
            parse_valid_with_override("url", "ftp://x/y").unwrap_err(),
            FileEntryError::InvalidUrl(_)
        ));
        assert!(parse_valid_with_override("url", "http://localhost:4000/m/x").is_ok());
    }

    fn parse_valid_with_override(key: &str, value: &str) -> Result<FileEntry, FileEntryError> {
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
        let ev = EventBuilder::new(Kind::Custom(KIND_FILE_METADATA as u16), "")
            .tags(rows.iter().map(|r| Tag::parse(r.clone()).unwrap()))
            .sign_with_keys(&keys)
            .unwrap();
        FileEntry::from_event(&ev)
    }

    #[test]
    fn rejects_bad_name() {
        assert!(matches!(
            parse_valid_with_override("name", "a/b.pdf").unwrap_err(),
            FileEntryError::InvalidName(_)
        ));
        assert!(matches!(
            parse_valid_with_override("name", "   ").unwrap_err(),
            FileEntryError::InvalidName(_)
        ));
    }

    #[test]
    fn version_and_replace_chain() {
        let entry = parse_valid(&[&["v", "3"], &["e", "abc123", "", "replace"]]).unwrap();
        assert_eq!(entry.version, 3);
        assert_eq!(entry.replaces.as_deref(), Some("abc123"));

        assert_eq!(
            parse_valid(&[&["v", "0"]]).unwrap_err(),
            FileEntryError::InvalidVersion
        );
        assert_eq!(
            parse_valid(&[&["v", "x"]]).unwrap_err(),
            FileEntryError::InvalidVersion
        );
    }

    #[test]
    fn tag_rows_round_trip_through_parse() {
        let original = parse_valid(&[&["v", "2"], &["e", "prev-id", "", "replace"]]).unwrap();
        let keys = Keys::generate();
        let ev = EventBuilder::new(
            Kind::Custom(KIND_FILE_METADATA as u16),
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
        assert_eq!(FileEntry::from_event(&ev).unwrap(), original);
    }
}
