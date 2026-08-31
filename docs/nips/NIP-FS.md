NIP-FS
======

File Storage
------------

`draft` `optional` `relay`

**Protocol dependencies**: NIP-01, NIP-94 (file metadata tags), NIP-09 (deletion).

The key words "MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", and "MAY"
in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Abstract

NIP-FS makes an uploaded file a first-class entity of a Buzz channel rather than
an attachment folded into one chat message. A file is a `kind:1063` (NIP-94)
event, channel-scoped by an `h` tag, listed in a dedicated "Files" view, and
removed with an ordinary NIP-09 deletion. Optional linear versioning lets a new
`kind:1063` event supersede a previous one while keeping its history reachable.

This NIP does not define the blob transport. The bytes are uploaded through the
existing Buzz media path (Blossom / `POST /media`); the `kind:1063` event only
records where they live and what they are.

## Event kind

| Kind | Name          | Scope        | Storage  |
|------|---------------|--------------|----------|
| 1063 | File Metadata | channel      | durable  |

`kind:1063` is a regular event. The latest `created_at` does **not** replace an
earlier one — every version is its own event (see *Versioning*).

## Event structure

```json
{
  "kind": 1063,
  "content": "Q3 planning deck — draft shared for review",
  "tags": [
    ["h", "6f9d2c1e-1b7a-4a2e-9f3c-2b8e5d4a1c00"],
    ["url", "https://relay.example/media/9f8a...bd.pdf"],
    ["x", "9f8a3c2b1d0e...bd"],
    ["m", "application/pdf"],
    ["size", "184320"],
    ["name", "q3-planning.pdf"],
    ["v", "1"]
  ]
}
```

### Tags

| Tag    | Required | Meaning |
|--------|----------|---------|
| `h`    | yes      | Channel UUID the file belongs to. Its membership defines who may read the file. |
| `url`  | yes      | Retrieval URL for the blob. MUST be `https:` (or `http:` for loopback dev relays). |
| `x`    | yes      | Lowercase hex SHA-256 of the blob (64 chars). Integrity check on download. |
| `m`    | yes      | MIME type, `type/subtype`. |
| `size` | yes      | Blob size in bytes, decimal, `> 0`, fits in `u64`. |
| `name` | yes      | Display file name. MUST NOT contain `/`, `\\`, or NUL; MUST be 1–255 chars after trimming. |
| `v`    | no       | Version number, decimal integer `>= 1`. Absent means `1`. |
| `e`    | no       | With marker `"replace"`: id of the `kind:1063` event this one supersedes. |

`content` is a human-readable description and MAY be empty.

Publishers MAY additionally include any standard NIP-94 informational tag
(`dim`, `blurhash`, `thumb`, `fallback`). Consumers MUST ignore tags they do
not recognise.

## Versioning

A new version of a file is a fresh `kind:1063` event that:

1. carries `["v", "<n>"]` with `n` strictly greater than the version it
   replaces, and
2. carries `["e", "<prev-event-id>", "", "replace"]` referencing the immediately
   previous version's event id.

Clients SHOULD present only the highest known version per replace-chain in the
Files list and offer the older events as history. The chain is advisory: a relay
MUST store and serve every version event independently. A `v` tag without an
`e`/`replace` tag is treated as a standalone file at that version number.

## Deletion

A file is removed by its author (or a channel admin, per the channel's existing
moderation rules) publishing a `kind:5` event referencing the `kind:1063` event
id, exactly as for any other channel content. Deleting a version event does not
delete the rest of the chain.

## Relay behaviour

- A `kind:1063` event without a valid `h` tag naming a channel the author may
  write to MUST be rejected.
- Read access to a `kind:1063` event follows the same channel-membership rule as
  `kind:1` messages in that channel.
- Relays SHOULD index `kind:1063` by channel so a Files view can be served with
  one filter (`{"kinds":[1063],"#h":["<channel>"]}`).

## Validation

Implementations MUST reject an event as malformed when any REQUIRED tag is
missing, `x` is not 64 lowercase hex chars, `size` is not a positive base-10
integer, `m` is not `type/subtype`, `name` violates the character/length rule,
or `v` is present but not an integer `>= 1`.
