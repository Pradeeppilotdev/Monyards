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

### Mint pipeline (next step to build)

For each mint, before calling `mint(string uri)`:

1. User types an X handle. Best-effort fetch of name + PFP -- unavatar.io for
   the PFP; the syndication timeline only as a name *autofill* with a ~2s
   timeout and a manual fallback. Never block the mint on this fetch.
2. Render the live preview card (same `<Lanyard />` component in the page).
3. `node bake.mjs --card-json ./card.json` → per-mint HTML.
4. Pin the HTML → `animation_url`. Pin a static card render → `image`. Build
   the metadata JSON and pin it → `tokenURI`.
5. Broadcast `mint(tokenURI)`.

Keep the `image` field a good static render -- most wallets never execute JS
and only show `image`, so a blank thumbnail makes the NFT look broken even when
the `animation_url` is fine.

## Known constraints

- The syndication endpoint is undocumented and flaky (empty 200s, occasional IP
  blocks). Design for it to fail: the mint path must work with just a typed
  name and a PFP.
- The baked HTML is ~6.5 MB because the GLB card is inlined. Fine for a
  hackathon; if size matters later, host the GLB on IPFS and reference it by
  CID instead of inlining.
- Test the physics inside a sandboxed iframe early -- that environment is
  stricter than your own site (no guarantees on WebGL context or load budget).