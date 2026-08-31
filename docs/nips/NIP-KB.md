NIP-KB
======

Kanban Board
------------

`draft` `optional` `relay`

**Protocol dependencies**: NIP-01, NIP-09 (deletion), NIP-29 (`h` group tag).

The key words "MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", and "MAY"
in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Abstract

NIP-KB gives a Buzz channel a Kanban board: an ordered set of task **cards**
spread across a fixed set of columns. A card is a `kind:40110` event,
channel-scoped by an `h` tag and identified by a stable `d` tag. The board is a
panel of the channel it belongs to — there is exactly one board per channel, and
its membership is the channel's membership.

The board has no event of its own. Its columns are the fixed set `todo` /
`doing` / `done`; v1 does not support renaming, adding, or removing columns.

## Event kind

| Kind  | Name        | Scope   | Storage |
|-------|-------------|---------|---------|
| 40110 | Kanban card | channel | durable |

`kind:40110` is a **regular** event. It is *not* replaceable and *not*
parameterized-replaceable: the relay stores every version. Clients reconstruct
the board by keeping, for each `d` value, only the event with the highest
`created_at` (ties broken by the lexically-greater `id`). This last-write-wins
merge is a client convention, not relay behaviour, so a move published by a user
other than the card's creator still wins if it is newer.

## Event structure

```json
{
  "kind": 40110,
  "content": "Wire the drag handlers and the position math.",
  "tags": [
    ["h", "6f9d2c1e-1b7a-4a2e-9f3c-2b8e5d4a1c00"],
    ["d", "11111111-2222-3333-4444-555555555555"],
    ["col", "doing"],
    ["pos", "1.5"],
    ["title", "Ship the board"],
    ["p", "9f8a3c2b1d0e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90"],
    ["e", "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0", "", "source"]
  ]
}
```

### Tags

| Tag       | Required | Meaning |
|-----------|----------|---------|
| `h`       | yes      | Channel UUID the card belongs to. Its membership defines who may read and write the card. |
| `d`       | yes      | Card UUID. Stable across every version of the card; the last-write-wins merge key. |
| `col`     | yes      | Column token. MUST be exactly one of `todo`, `doing`, `done`. |
| `pos`     | yes      | Fractional sort key within the column, a finite base-10 number (may be negative). Lower sorts first. |
| `title`   | yes      | Card title, 0–200 characters after trimming, no NUL. MUST be non-empty unless the card is a tombstone (see *Deletion*). |
| `p`       | no       | Assignee public key, 64 lowercase hex. v1 does not distinguish a human assignee from an agent. |
| `e`       | no       | With marker `"source"`: id (64 lowercase hex) of the `kind:9` message the card was created from. |
| `deleted` | no       | With value `"true"`: this version retracts the card. Any other value is malformed. |

`content` is a free-form description, 0–20000 characters, and MAY be empty.

Consumers MUST ignore tags they do not recognise.

## Ordering

Cards in a column are ordered by ascending `pos`. To place a card between two
others, a client sets its `pos` to a value strictly between the two neighbours'
(their midpoint); to append, it uses `neighbour ± 1`; the first card in an empty
column uses `0`. Only the moved card is republished — sibling cards keep their
positions. Because repeated subdivision of the same gap eventually exhausts
`f64` precision, a client SHOULD occasionally renumber a column with evenly
spaced integers by republishing its cards.

If two visible cards in a column share a `pos`, clients SHOULD break the tie by
ascending `created_at` then by `id`.

## Editing and moving

Every edit (title, description, assignee) and every move (column and/or
position) is a fresh `kind:40110` event carrying the same `d` and a newer
`created_at`, with the full desired tag set — tags are not deltas. Clients
display the newest version per `d`.

## Deletion

A card is removed either by:

1. publishing a newer `kind:40110` version for its `d` carrying
   `["deleted", "true"]` (the `title` tag MAY then be empty), or
2. publishing a NIP-09 `kind:5` referencing any `kind:40110` event id for that
   `d`, per the channel's existing moderation rules.

A client MUST hide a card whose winning version is a tombstone, and SHOULD hide
a card once any version in its `d` history is the target of an authorised
`kind:5`.

## Relay behaviour

- A `kind:40110` event without a valid `h` tag naming a channel the author may
  write to MUST be rejected.
- Read access to a `kind:40110` event follows the same channel-membership rule
  as `kind:9` messages in that channel.
- Relays SHOULD index `kind:40110` by channel so a board can be served with one
  filter (`{"kinds":[40110],"#h":["<channel>"]}`). No board-specific index is
  required.

## Validation

Implementations MUST reject an event as malformed when any REQUIRED tag is
missing, `h` or `d` is not a UUID, `col` is not one of the three tokens, `pos`
is not a finite number, `title` is longer than 200 characters (or empty on a
non-tombstone), `content` is longer than 20000 characters, `p` or the `source`
`e` value is not 64 lowercase hex, or a `deleted` tag carries any value other
than `"true"`.
