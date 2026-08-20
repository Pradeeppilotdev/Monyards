# Monad Lanyard NFT

Interactive NFT collection on Monad. Each token's `animation_url` is a fully
self-contained HTML page running the React Bits `<Lanyard />` component
(three.js + Rapier physics) with the holder's name, X handle and PFP baked into
the card texture. The contract itself is a dumb ERC-721 -- all personalization
happens off-chain before the mint.

```
LanyardNFT (ERC-721)
  └─ tokenURI → IPFS metadata.json
                  ├─ image:           static card render (marketplace thumbnail)
                  └─ animation_url:   per-mint HTML (interactive Lanyard)
```

## Repo layout

| Path         | What it is                                                   |
|--------------|--------------------------------------------------------------|
| `contract/`  | Foundry project: `LanyardNFT.sol`, deploy script, tests      |
| `animation/` | Vite app building ONE self-contained HTML + `bake.mjs`       |
| `server/`    | Express API: per-mint bake + IPFS pinning (`/api/bake`)      |
| `mint/`      | Mint DApp: username input, live preview, wallet mint         |
| `shared/`    | Card SVG renderer shared by bake CLI, server and frontend    |

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

## 2. Interactive page (`animation/`)

Uses the exact React Bits `<Lanyard />` source. Two card faces:

- **Front** -- holder's PFP + name + @handle, rendered as a card image.
- **Back** -- Monad back-card design (dark, logomark + "MONAD / LANYARD"), or a
  custom image baked per mint.

The lanyard band is a purple (`#6e54ff`) woven-cord texture (`lanyard.png`)
with a single white Monad logomark printed at its center, exactly like the
ReactBits band stamped its diamond. The texture tiles 4x along the cord
(`repeat={[-4,1]}` in `Lanyard.jsx`), so the mark appears at four evenly-spaced
points along the rope and bends/sags with the ribbon like a printed lanyard.
The card renders larger and with a thinner band via the `lanyardWidth` and
group scale in `main.jsx`.

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

Open the baked file directly in a browser -- the card should swing under
physics and be draggable. Also open it **inside a sandboxed iframe**, since
that is the environment wallets and OpenSea render `animation_url` in.

### Mint flow (built)

The mint frontend (`mint/`) talks to the bake server (`server/`) and then sends
the mint transaction from the user's wallet. The server never holds keys — it
only does off-chain baking + pinning.

```bash
# 1. Build the animation page once (produces the dist/index.html template)
cd animation && npm install && npm run build

# 2. Start the bake server (dry-run pinning until PINATA_JWT is set)
cd ../server && cp .env.example .env && npm install && npm start

# 3. Run the mint DApp (proxies /api to the server in dev)
cd ../mint && npm install && npm run dev
```

Flow for one mint:

1. User types an X handle. The page fetches the PFP via unavatar.io and renders
   a live `<Lanyard />` preview with the same card SVG that will be baked.
2. On "Mint", the frontend POSTs `/api/bake` `{ username, name, pfp }`.
3. The server renders the front card SVG, bakes both card faces into the built
   HTML (`bakeHtml`), and pins three things: the HTML (`animation_url`), the
   card image (`image`), and the metadata JSON (`tokenURI`).
4. The frontend reads `mintPrice()` from the contract and broadcasts
   `mint(tokenURI)` from the connected wallet.
5. After the mint the page offers **Record share clip**: it captures the live
   WebGL preview via `canvas.captureStream` + `MediaRecorder` while driving a
   scripted sideways pull (`driveRef.pull()` in `Lanyard.jsx`), so the card
   visibly swings on the rope. The resulting WebM can be downloaded and posted
   to X — no server involved, recording happens fully in the browser
   (`mint/src/record.js`).

Keep the `image` field a good static render — most wallets never execute JS and
only show `image`, so a blank thumbnail makes the NFT look broken even when the
`animation_url` is fine.

### Production checklist

- Set `PINATA_JWT` in `server/.env` to turn on real IPFS pinning (without it the
  server returns non-resolvable fake CIDs).
- Set `CONTRACT_ADDRESS` (and `CHAIN_ID` / `RPC_URL` / `EXPLORER_URL`) after
  deploying the contract.
- Move `card.glb` to IPFS-by-CID to cut the baked HTML from ~6.5 MB to a few
  hundred KB (see constraints below).
- Test the baked HTML inside a sandboxed iframe — that's how wallets and
  marketplaces render `animation_url`.

## Known constraints

- The syndication endpoint is undocumented and flaky (empty 200s, occasional IP
  blocks). Design for it to fail: the mint path must work with just a typed
  name and a PFP.
- The baked HTML is ~6.5 MB because the GLB card is inlined. For production,
  host `card.glb` and the large textures on IPFS and reference them by CID from
  the HTML instead of inlining — the page drops to a few hundred KB and IPFS
  requests can be served through a public gateway or a dedicated pinning
  provider for latency.
- The sandboxed-iframe render environment is stricter than your own site (no
  guarantees on WebGL context or load budget) — verify the baked HTML there
  before launch.