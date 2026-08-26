# Hosting `cards.pradeeppilot.xyz`

The bake server is **stateful** — SQLite + stored share pages on disk + long
IPFS pin calls. That rules out Vercel/Cloudflare *serverless* (ephemeral
filesystem: the DB and `/s/:id` pages would evaporate). Two good paths:

---

## Path A — Cloudflare Tunnel from this machine (free, 10 minutes, testnet-ready)

Run the server where it already works; Cloudflare exposes it. Your machine
must stay on.

1. **Build the frontend** (one domain serves DApp + API):
   ```bash
   cd mint && npm run build
   ```

2. **Server env** (`server/.env`):
   ```bash
   PUBLIC_URL=https://cards.pradeeppilot.xyz
   ```

3. **Install cloudflared** and authenticate:
   ```bash
   sudo apt install cloudflared   # or download the .deb from Cloudflare
   cloudflared tunnel login       # opens browser, pick your domain
   ```

4. **Create the tunnel + DNS** (Cloudflare creates the CNAME for you):
   ```bash
   cloudflared tunnel create lanyard
   cloudflared tunnel route dns lanyard cards.pradeeppilot.xyz
   ```

5. **Run it** (dev-style):
   ```bash
   cd server && npm start
   # in another terminal:
   cloudflared tunnel --url http://localhost:8787 run lanyard
   ```
   `https://cards.pradeeppilot.xyz` is now live — DApp, API, `/s/:id` pages,
   everything first-party.

6. **Make it permanent** — write `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: <tunnel-uuid from `cloudflared tunnel list`>
   credentials-file: /home/pradeep/.cloudflared/<tunnel-uuid>.json
   ingress:
     - hostname: cards.pradeeppilot.xyz
       service: http://localhost:8787
     - service: http_status:404
   ```
   Then `cloudflared service install` (runs on boot).

---

## Path B — always-on VPS (Hetzner ~€4/mo, Oracle free tier, any Ubuntu box)

1. Provision Ubuntu 22+/Debian, install Node 22 (`node:sqlite` needs ≥22.5):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
   ```
2. Copy the repo (rsync/git), then on the box:
   ```bash
   cd IDnad/animation && npm ci && npm run build   # template for bakes
   cd ../mint && npm ci && npm run build           # DApp served by Express
   cd ../server && npm ci && cp .env.example .env  # fill in:
   #   PINATA_JWT=...  CONTRACT_ADDRESS=0xdfcfe6...
   #   PUBLIC_URL=https://cards.pradeeppilot.xyz
   ```
3. **systemd** — `deploy/lanyard.service` is included:
   ```bash
   sudo cp deploy/lanyard.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now lanyard
   ```
4. **DNS + TLS**: point `cards.pradeeppilot.xyz` A-record at the box, then
   either Cloudflare proxy (orange cloud = TLS done at CF, origin can be HTTP)
   or `certbot --nginx` for direct TLS.
5. Install `cloudflared` on the VPS instead of step 4 if you prefer tunneling
   from there too (same config as Path A step 6).

---

## Why not Vercel / Cloudflare Pages?

- **Vercel functions**: ephemeral `/tmp` only — SQLite and stored pages vanish
  between invocations and across instances; bake timeouts at 10–60s.
- **Cloudflare Workers**: no Node `fs`/`node:sqlite` at all — a full storage
  rearchitecture (D1 + R2) for what a $4 box does natively.

The frontend alone *is* static and could live on either — but hosting it from
Express on the same domain removes CORS/API-URL concerns entirely, which is
why `cards.pradeeppilot.xyz` points at this server, not a Pages deploy.

## After it's live

- Mint once, then verify: `curl https://cards.pradeeppilot.xyz/api/config`
  shows the contract, `/s/<id>` serves a page, and a fresh mint's `tokenURI`
  is `https://cards.pradeeppilot.xyz/meta/<id>`.
- That last one is the endgame from the debugging thread: first-party
  metadata + og:image + animation page, zero public-gateway roulette.
