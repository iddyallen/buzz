# Self-hosting the Chait fork (Buzz + Kanban)

Instructions for an agent standing up this fork (`feat/file-storage` — Buzz plus
the NIP-KB Kanban board and `buzz kanban` CLI) on the operator's own server, so
a real community lives on that server and the desktop client (also built from
this fork) can create channels, boards, and agents against it.

## Why a plain `just dev` / upstream image is not enough

- The Kanban events (`kind:40110` card, `kind:40111` board) are **only accepted
  by a relay built from this fork**. `ghcr.io/block/buzz:main` rejects them with
  `restricted: unknown event kind`.
- The **desktop client must also be this fork** — the board UI and the
  `KIND_KANBAN_*` constants live in `desktop/src/`. An upstream desktop build
  will not render the board even against a fork relay.
- The desktop "Create community" button uses **Block's hosted service**
  (`*.communities.buzz.xyz`, builder login) and cannot target a self-hosted
  relay. Self-hosting uses **one relay = one community** (its own domain);
  clients **Join** it by `wss://` URL. Extra communities on the same relay are
  created out-of-band via the operator API (see the last section).

So the deployment is: **fork relay image + fork desktop client + your DNS**.

---

## 0. Prerequisites

- A Linux host with Docker + Docker Compose v2.24.4+ and a public IP.
- A DNS name pointing at it, e.g. `chait.example.com` (A/AAAA record).
- Ports 80 and 443 open (Caddy terminates TLS and gets a Let's Encrypt cert).
- This repo checked out at the fork branch on a build machine (can be the same
  host) with the Rust + Node toolchain, or just Docker to build the image.
- A Nostr keypair for the **relay owner** (the human who owns the community).
  Generate one and keep the nsec safe:
  ```bash
  cargo run -q -p buzz-cli -- --help >/dev/null   # ensure it builds
  # any nostr keygen works; you need the 64-char hex pubkey for RELAY_OWNER_PUBKEY
  ```
  If you have `nak`: `nak key generate` → note `pubkey` (hex).

---

## 1. Build the fork relay image

The `Dockerfile` at the repo root builds `buzz-relay` + `buzz-admin` + the web
bundle into a `debian-slim` runtime image. Build it from the fork checkout and
tag it locally (or push to a private registry the host can pull from):

```bash
cd <repo-root>              # on the fork branch
git rev-parse --short HEAD  # note the sha for the tag

docker build \
  --build-arg BUZZ_SOURCE_SHA="$(git rev-parse HEAD)" \
  -t chait-relay:$(git rev-parse --short HEAD) \
  -t chait-relay:latest \
  .
```

Multi-arch: build on a runner of the target architecture (the Dockerfile is
platform-agnostic, no `--platform` pins). If the host pulls from a registry:

```bash
docker tag chait-relay:latest registry.example.com/chait-relay:latest
docker push registry.example.com/chait-relay:latest
```

`docker build` takes ~10–20 min cold (cargo-chef caches deps across rebuilds).

---

## 2. Configure the deployment

The self-host bundle is `deploy/compose/` (separate from the repo-root
`docker-compose.yml`, which is local-dev only). It runs the relay + Postgres +
Redis + MinIO + Caddy.

```bash
cd deploy/compose
cp .env.example .env
```

Edit `.env` — replace **every** `CHANGE_ME` and set the fork image + your domain:

| Key | Value |
|---|---|
| `BUZZ_IMAGE` | `chait-relay:latest` (or `registry.example.com/chait-relay:latest`) |
| `BUZZ_DOMAIN` | `chait.example.com` |
| `RELAY_URL` | `wss://chait.example.com` |
| `BUZZ_MEDIA_BASE_URL` | `https://chait.example.com/media` |
| `BUZZ_MEDIA_SERVER_DOMAIN` | `chait.example.com` |
| `BUZZ_CORS_ORIGINS` | `https://chait.example.com` |
| `RELAY_OWNER_PUBKEY` | your owner **hex** pubkey (64 chars, no `npub`) |
| `BUZZ_RELAY_PRIVATE_KEY` | fresh 64-hex — the relay's own signing key, keep stable |
| `BUZZ_GIT_HOOK_HMAC_SECRET` | fresh random 64-hex |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | fresh random strings |
| `BUZZ_S3_ACCESS_KEY` / `BUZZ_S3_SECRET_KEY` | fresh random strings (bundled MinIO uses them) |
| `BUZZ_AUTO_MIGRATE` | `true` (bootstraps the schema on first boot) |
| `BUZZ_REQUIRE_RELAY_MEMBERSHIP` | `true` for a closed community, `false` to let anyone join |
| `BUZZ_REQUIRE_AUTH_TOKEN` | `true` |

Generate secrets:
```bash
openssl rand -hex 32   # run once per hex secret
```

`RELAY_URL` is load-bearing: on first boot the relay **auto-creates its own
community** from `RELAY_URL`'s host (`chait.example.com`) and bootstraps
`RELAY_OWNER_PUBKEY` as that community's owner. The Host clients send **must**
match this exactly — the relay fails closed on an unknown Host.

---

## 3. Start it

```bash
cd deploy/compose
./run.sh config                       # render + sanity-check merged compose
BUZZ_COMPOSE_TLS=true ./run.sh start   # includes Caddy → automatic HTTPS
```

`./run.sh start` runs `docker compose up -d --wait`; it blocks until the relay
healthcheck (`/_readiness` on :8080) passes. Then:

```bash
./run.sh status
./run.sh logs relay | tail -50
# expect: "Deployment community ensured host=chait.example.com community=<uuid>"
curl -fsS https://chait.example.com/.well-known/nostr.json >/dev/null && echo NIP-05 ok
```

Verify the relay speaks WebSocket + accepts the Kanban kinds:
```bash
# NIP-11 relay info
curl -fsS https://chait.example.com/ -H 'Accept: application/nostr+json' | jq '.supported_nips, .software'
```

If `BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`, add the members who may connect
(the owner is added automatically; add each additional human/agent pubkey):
```bash
./run.sh add-member <npub-or-hex> --role admin
./run.sh add-member <npub-or-hex>              # default role: member
./run.sh list-members
```

---

## 4. Connect the desktop client (must be the fork build)

On each machine that will use the community, run the fork desktop with **no
bundled relay** so it asks which community to join:

```bash
cd <repo-root>                 # fork branch
just desktop-standalone        # builds fork sidecars (incl. `buzz` CLI), opens the app
```

In the app:

1. Community rail (left edge) → **+** (`Add community`).
2. **Join an existing community** → enter `wss://chait.example.com` → **Connect**.
3. If the relay is closed (`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`), that pubkey
   must already be a relay member (step 3 above) or the connection is refused.

Now create a channel, open the **board** (icon in the channel header), add
columns/cards. Kanban events go to `chait.example.com`, which understands them.

### Agents

Managed agents inherit the workspace relay, so an agent created in this
community connects to `chait.example.com` and its `buzz kanban` calls work.
For an agent to actually respond it must be a **member of the channel** you
`@mention` it in (Channel members → Add agent) and, if the relay is closed,
a **relay member** too (`./run.sh add-member <agent-pubkey>`).

---

## 5. Gotchas (each of these has bitten us)

- **`~/.local/bin/buzz` shadowing.** If a released `/Applications/Buzz.app` is
  installed, it drops `~/.local/bin/buzz` → the app bundle's CLI, and that
  directory is first on the managed-agent `PATH`. Agents then run the *old*
  `buzz` with no `kanban` subcommand. Fix: uninstall the released app, or
  `ln -sf <repo-root>/target/debug/buzz ~/.local/bin/buzz` and restart the
  agents.
- **NIP-98 Host must match exactly.** The client signs `u=<scheme>://<host>/...`
  with the host it connected to. That host string must equal the
  `communities.host` row (i.e. `RELAY_URL`'s authority). `localhost:3000` and
  `127.0.0.1:3000` are **distinct** here — do not mix them. For a real deploy
  this is just your one domain, so it is only a footgun in local testing.
- **Stale board view.** The desktop board dialog refetches on open; if a card
  was moved while it was closed you must reopen the dialog (fixed in this fork,
  but a very old cached client tab can still lag until reopened).
- **Backups.** `./run.sh backup-hint` — Postgres, the MinIO bucket, the
  `buzz-git-data` volume, `.env` (especially `BUZZ_RELAY_PRIVATE_KEY`), and the
  Caddy volumes. Keep them from the same maintenance window.
- **Upgrades.** Rebuild the image from a newer fork commit, bump `BUZZ_IMAGE`,
  `./run.sh upgrade`. Migrations run on boot when `BUZZ_AUTO_MIGRATE=true`.

---

## 6. Optional: more than one community on the same relay

The relay can host additional communities via the operator API (this is what
`communities.buzz.xyz` uses internally). In `deploy/compose/.env`:

```
RELAY_OPERATOR_PUBKEYS=<operator hex pubkey>[,<hex>...]
RELAY_OPERATOR_API_ORIGIN=https://chait.example.com
```

Restart the relay (`./run.sh restart`). Then provision a community by POSTing a
**NIP-98-signed** request from an operator key:

```
POST https://chait.example.com/operator/communities
Authorization: Nostr <base64 kind:27235 event, u = this URL, method = POST>
Content-Type: application/json

{ "host": "team-b.chait.example.com", "initial_owner_pubkey": "<owner hex>", "create_only": true }
```

Point a DNS record for `team-b.chait.example.com` at the same host (Caddy's
`{$BUZZ_DOMAIN}` block only covers the primary domain — add a wildcard or an
extra site block in `deploy/compose/Caddyfile` for subdomains). Clients then
**Join** `wss://team-b.chait.example.com`.

The desktop "Create community" button will still not target this relay — that
flow is Block-hosted only. Provisioning is an operator/CLI task here.
