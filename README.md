# Monad Lanyard NFT

Interactive NFT collection on Monad. Each token's `animation_url` is a fully
self-contained HTML page running the React Bits `<Lanyard />` component
(three.js + Rapier physics) with the holder's name, X handle and PFP baked into
the card texture. The contract itself is a dumb ERC-721 -- all personalization
happens off-chain before the mint.

```
LanyardNFT (ERC-721)
  └─ tokenURI → IPFS metadata.json
                  ├─ image:           static lanyard render (marketplace thumbnail)
                  └─ animation_url:   per-mint HTML (interactive Lanyard)
```

## Repo layout

| Path         | What it is                                                   |
|--------------|--------------------------------------------------------------|
| `contract/`  | Foundry project: `LanyardNFT.sol`, deploy script, tests      |
| `animation/` | Vite app building ONE self-contained HTML + `bake.mjs`       |
| `server/`    | Express API: bake + IPFS pinning + local share store (`/api/bake`) |
| `mint/`      | Mint DApp: username input, live preview, record/share, wallet mint |
| `shared/`    | Card SVG renderer + embedded Caveat font shared by bake CLI, server and frontend |

## 1. Contract (`contract/`)

Standard ERC-721 (OpenZeppelin v5, ERC721URIStorage). It only caps the supply,
gates minting, stores the pinned metadata URI per token and lets the owner
withdraw.

```bash
cd contract
forge build && forge test

# deploy to Monad testnet (chain 10143)
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
export PRIVATE_KEY=...
export MONADSCAN_API_KEY=...          # only needed for verify
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --verify

# mint one token (tokenURI must already be pinned to IPFS)
cast send $CONTRACT 'mint(string)' 'ipfs://bafybeig.../metadata.json' \
  --rpc-url monad_testnet --private-key $PRIVATE_KEY
```

Networks (checked Aug 2026):

| Network | Chain ID | RPC                            | Explorer                  | Faucet             |
|---------|----------|--------------------------------|---------------------------|--------------------|
| Testnet | 10143    | https://testnet-rpc.monad.xyz  | https://testnet.monadscan.com | https://faucet.monad.xyz |
| Mainnet | 10150    | https://rpc.monad.xyz          | https://monadscan.com    | n/a (real MON)     |

## 2. Card design (`shared/card-svg.js`)

Monad Blitz event-badge energy, rendered as a self-contained SVG (600×906):

- Near-black print-stock background whose gradient is **blended per-mint**:
  the PFP's dominant color is mixed 55% into Monad purple (`#836EF9`) so every
  card stays on-brand while carrying its owner's color DNA.
- Giant stencil-cut **LYRD** wordmark (mask slashes, heavy system font).
- The PFP is shown in its **original colors** inside a rounded tile with a
  misregistered accent ink ring + registration marks — the portrait provides
  the life, the brand owns the card.
- White paper name strip, slightly rotated, with the name written in an
  **embedded Caveat** woff2 (`shared/name-font.js`, SIL OFL) so the
  marker-handwritten look renders identically in every SVG rasterizer.
- Footer: deterministic serial `NO. XXXX`, decorative barcode, `#10143` chip.

The back face (`animation/src/assets/back-card.svg`) matches: logomark hero
with misregistered ring, stencil "MONAD", handwritten strip, same footer rail.

## 3. Interactive page (`animation/`)

React Bits `<Lanyard />` physics scene. Card faces are composited into the
GLB's texture atlas (front = left half, back = right half) with a ~6% overscan
so the rounded corners never sample the atlas's white padding.

Framing lives in `animation/src/camera.js`:

- `previewCamera()` — the mint frontend (card ≈ 53% of frame height).
- `stageCamera()` — the baked share page: card ≈ 65% of frame height on
  desktop, pulled back on phones so it stays fully grabbable/swingable.

The baked page also renders the **Silk shader background** (`Silk.jsx` lives in
`animation/src/`, shared with the frontend) plus ambient purple glows, so a
shared link looks like the product, not a tech demo.

Everything (three.js, Rapier, `card.glb`, textures) is inlined into a single
`dist/index.html` via `vite-plugin-singlefile`, so the file can be pinned to
IPFS and rendered by wallets/marketplaces with zero external requests.

The card images enter as placeholder tokens (`__LANYARD_FRONT_IMG__`,
`__LANYARD_BACK_IMG__`). `bake.mjs` swaps them for real data URLs, producing a
per-mint file.

### Test the interactive part in isolation

```bash
cd animation
npm install
npm run dev          # live preview with the built-in card texture
npm run build        # → single self-contained dist/index.html

# bake a per-mint page (auto-generates an SVG card from name + PFP)
npm run bake -- --username vitalik --name "Vitalik" \
  --pfp https://unavatar.io/x/vitalik --out out/vitalik.html

# or supply pre-made card images / a card JSON produced by the mint frontend
npm run bake -- --front ./card-front.png --back ./card-back.png --out out/0.html
npm run bake -- --card-json ./card.json --out out/0.html   # { "front": "...", "back": "..." }
```

Always `npm run build` after touching `animation/src` — bakes read the built
`dist/index.html` template.

Open the baked file directly in a browser -- the card should swing under
physics and be draggable. Also open it **inside a sandboxed iframe**, since
that is the environment wallets and OpenSea render `animation_url` in.

## 4. Mint flow (`mint/` + `server/`)

The mint frontend talks to the bake server and then sends the mint transaction
from the user's wallet. The server never holds keys — it only does off-chain
baking, pinning and share storage.

```bash
# 1. Build the animation page once (produces the dist/index.html template)
cd animation && npm install && npm run build

# 2. Start the bake server (dry-run pinning until PINATA_JWT is set)
cd ../server && cp .env.example .env && npm install && npm start

# 3. Run the mint DApp (proxies /api to the server in dev)
cd ../mint && npm install && npm run dev
```

Flow for one visitor:

1. The lanyard is live the moment the page opens — no wallet, no input. A
   default card hangs on the rope and can be dragged/swung immediately.
   Controls sit on the left; the interactive card fills the right.
2. The user types an X handle; the page fetches the PFP via unavatar.io,
   extracts a palette from it (blended with Monad purple) and re-renders the
   live preview with the same card SVG that will be baked.
3. **Record a loop** (no wallet needed): captures the WebGL preview via
   `canvas.captureStream` + `MediaRecorder` while driving a scripted sideways
   pull (`driveRef.pull()` in `Lanyard.jsx`). Frames are composited over the
   silk backdrop (no black background), the record button doubles as a
   stop/cancel, and finished clips can be discarded with an ✕.
4. **Share on X**: captures the **whole lanyard** (card + rope + live silk) as
   a PNG, sends it to `POST /api/bake` as `shareImage`, then:
   - **Mobile**: one tap — the native share sheet opens with image + caption
     + link attached; pick X and post.
   - **Desktop**: image + caption + link are staged on the clipboard and an
     **"Open X composer →"** button appears (a real user-gesture anchor, so
     popup blockers can never eat it). One paste, then post. If the clipboard
     refuses, the PNG is auto-downloaded so attaching it stays one click.
   The tweet text: `@handle printed a Monad Lanyard 🟣 / Drag it, swing it,
   mint yours 👇 / <link>`.
5. **Minting** (optional): wallet connect runs through **Reown AppKit**
   (WalletConnect) when `VITE_REOWN_PROJECT_ID` is set in `mint/.env`
   (get a free project id at cloud.reown.com); without it the app falls back
   to plain injected wallets. Connect → POST `/api/bake`
   `{ username, name, pfp, palette, shareImage }` → server bakes + pins
   HTML/`image`/metadata → frontend broadcasts `mint(tokenURI)`.

## 5. Share store (`server/db.js`)

Every bake is stored locally (zero-dep `node:sqlite` + files under
`server/data/`): the share image, the full baked page, both CIDs, handle and
name. Served first-party:

| Route            | What it serves                                    |
|------------------|---------------------------------------------------|
| `GET /i/:id.png` | Stored share image (immutable cache)              |
| `GET /s/:id`     | Stored interactive page — no IPFS gateway needed  |
| `GET /api/wall`  | Recent shares — ready for a gallery wall          |

Set `PUBLIC_URL=https://your-domain` in `server/.env` and the bake response's
`shareUrl` / `imageUrl` (and the HTML's `og:image`) point at your domain
instead of IPFS gateways — **X unfurls first-party URLs reliably**, so the
timeline can show the lanyard even when nobody attaches an image.

Keep the `image` field a good static render — most wallets never execute JS and
only show `image`, so a blank thumbnail makes the NFT look broken even when the
`animation_url` is fine. The mint flow always sends a PNG (`shareImage`) for
exactly this reason.

## 6. Production checklist

- Set `PINATA_JWT` in `server/.env` to turn on real IPFS pinning (without it the
  server returns non-resolvable fake CIDs).
- Set `PUBLIC_URL` once the bake server has a public domain — first-party
  share links + reliable og:image unfurls.
- Set `CONTRACT_ADDRESS` (and `CHAIN_ID` / `RPC_URL` / `EXPLORER_URL`) after
  deploying the contract.
- `npm run build` in `animation/` before any bake session — bakes read the
  built template.
- Move `card.glb` to IPFS-by-CID to cut the baked HTML from ~6.5 MB to a few
  hundred KB (see constraints below).
- Test the baked HTML inside a sandboxed iframe — that's how wallets and
  marketplaces render `animation_url`.

## Known constraints

- The unavatar.io PFP endpoint is best-effort (empty 200s, occasional blocks).
  Design for it to fail: the mint path must work with just a typed name.
- X offers no API to attach images to a web-composer post without OAuth, so
  the desktop share always ends with one manual paste. Mobile is one tap via
  the native share sheet.
- The baked HTML is ~6.5 MB because the GLB card is inlined. For production,
  host `card.glb` and the large textures on IPFS and reference them by CID from
  the HTML instead of inlining — the page drops to a few hundred KB and IPFS
  requests can be served through a public gateway or a dedicated pinning
  provider for latency.
- The sandboxed-iframe render environment is stricter than your own site (no
  guarantees on WebGL context or load budget) — verify the baked HTML there
  before launch.
