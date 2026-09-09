# Referral + Designer-Royalty Design Spec

Goal for the Metropolis (Monad) hackathon: turn *attention* into *verifiable
economic stake*. Today a Lanyard share drives traffic to the mint DApp, but the
sharer earns nothing on-chain — the "attention" loop is decorative. This spec
adds two on-chain earning loops plus end-to-end attribution:

1. **Referral fee at mint** — minting via someone's link pays the referrer a
   bps of the mint price.
2. **Designer royalty (ERC2981)** — whoever created a specific card earns a
   bps royalty on every secondary sale of that card. "Your style is ownable."

Both are off-the-shelf primitives, cheap to audit, and easy to show in a demo:
shared link → new wallet mints → referrer balance grows → claim.

---

## 1. On-chain (LanyardNFT.sol v2)

Pre-mainnet, so deploy a fresh contract with new signatures — no migration.

### State + config (owner-settable)

```solidity
uint256 public referralBps;   // share of mintPrice paid to referrer, e.g. 1000 = 10%
uint256 public royaltyBps;    // ERC2981 secondary-sale royalty, e.g. 500 = 5%

// Attribution: which token was created because of whom.
mapping(uint256 => address) public referrerOf;      // tokenId -> referrer wallet
mapping(address => uint256) public referralBalance; // pull-payment accrued fees
```

### mint signature (breaking)

```solidity
function mint(string calldata uri, address referrer) external payable nonReentrant returns (uint256)
```

Validation (all existing rules kept: one-per-wallet immutable, maxSupply,
mintPrice, mintEnabled, uri length):

- `referrer == address(0)` is allowed (no referral), **or**
- `referrer != msg.sender` (`require(referrer != msg.sender, "cannot self-refer")`)
- `mintCount[referrer] > 0` — only wallets that already hold a Lanyard can
  receive a referral. This prevents lazy address farming and ties the incentive
  to *actual* graph growth: a legitimate referrer is a real creator.

On success:

```solidity
referrerOf[tokenId] = referrer;                       // attribution, always recorded
uint256 fee = (mintPrice * referralBps) / 10000;
if (fee > 0) referralBalance[referrer] += fee;        // pull-payment; no ETH sent inside mint
emit Referred(referrer, msg.sender, tokenId, fee);
```

Designer royalty: at mint, `_setTokenRoyalty(tokenId, msg.sender, royaltyBps)`.

### Pull-payment claim

```solidity
function claimReferralFees() external nonReentrant returns (uint256)
```
Transfers `referralBalance[msg.sender]`, zeroes the balance. Pull-not-push:
mint and refund already do external calls; fees are accrued, never pushed,
so a malicious referrer contract can't grief anyone's mint.

### ERC2981

- Inherit `ERC2981` (already in OpenZeppelin 5.1.0 vendored in `contract/lib`).
- `royaltyInfo(tokenId, salePrice)` → `(referrerOf-independent; designer = original minter)`.
  Store designer = `msg.sender` at mint via `_setTokenRoyalty`.
- `whіthdraw()` unchanged; owner pulls accumulated mint revenue.

### Owner admin

```solidity
setReferralBps(uint256)  // capped, e.g. <= 2500
setRoyaltyBps(uint256)   // capped via ERC2981 helper, e.g. <= 1000
```

### Events

```solidity
event Referred(address indexed referrer, address indexed referred, uint256 indexed tokenId, uint256 fee);
event ReferralBpsUpdated(uint256 oldBps, uint256 newBps);
```

### Tests (contract/test/LanyardNFTReferral.t.sol)

- mint with `address(0)` referrer → no attribution, no fee.
- mint with referrer == msg.sender → revert `cannot self-refer`.
- mint with a non-holder referrer → revert (referrer must have minted).
- mint with valid referrer on paid mint → `referrerOf` set + fee accrued.
- claim transfers accrued fees, zeroes balance, reverts on reentrant attempt.
- royaltyInfo returns (original minter, salePrice * bps / 10000).
- existing one-per-wallet / maxSupply / refund tests still pass.

---

## 2. Off-chain attribution (server)

The mint frontend needs to know "who sent this visitor" and persist it, and the
minted token's metadata should record the referral as a first-class trait.

### DB (server/db.js) — additive columns via ALTER (existing pattern)

```sql
ALTER TABLE shares ADD COLUMN token_id INTEGER;   -- set on /api/minted
ALTER TABLE shares ADD COLUMN ref_token_id INTEGER; -- set on /api/bake
```

### /api/bake (server/index.js)

- Accept optional `refTokenId` in the body.
- If present, resolve it to the referrer's share → handle/displayName:
  `SELECT ... FROM shares WHERE token_id = ?`. If no row (token minted on an
  older server or share pruned) → skip quietly, still OK.
- Add an attribution trait to `metaJson.attributes`:
  ```js
  { trait_type: 'minted_via', value: '@referrerHandle' }
  ```
- Store `ref_token_id` on the new share row.

### /api/minted (server/index.js)

- Accept optional `tokenId`; store it (`token_id` column) alongside `minted = 1`.
  This creates the `tokenId ⇄ share` map the referral flow depends on.

### New endpoint: GET /api/refinfo?tokenId=…

Returns `{ handle, displayName } | null` so the DApp can render “You’re minting
via @handle’s card” chip. Trusted input (frontend only shows it, contract
re-validates).

### Share URL / referral link

The pretty share page stays `cards.pradeeppilot.xyz/s/:id` (X unfurl). The
**referral link** that actually accrues value is:

```
https://cards.pradeeppilot.xyz/?ref=<tokenId>
```

`tokenId` is used (not raw address) because it is: compact, self-validating on
chain (`ownerOf` must exist and be a minted Lanyard), and referral
automatically *stops* if the referrer transfers their card away.

---

## 3. Frontend (mint/src/App.jsx, abi.js)

### Load time — parse ?ref=

- On mount read `URLSearchParams(window.location.search).get('ref')`.
- If a ref tokenId exists, validate: `ownerOf(refTokenId)` via public client;
  if it throws (no such token) ignore silently.
- Show chip in the mint box: “Via @handle's card — they earn on your mint”
  (fetch `/api/refinfo?tokenId=`).
- Pass `refTokenId` through to `/api/bake` (attribution trait) and resolve the
  referrer's address via `ownerOf` to call `mint(uri, referrer)`.

### Mint call

```js
const res = await walletClient.writeContract({
  address, ABI 'mint', args: [data.tokenURI, referrerAddress], ...
})
```
Note: currently `ownerOf` read requires the referrer token to exist; wrap in
try/catch → fall back to `address(0)`.

### Post-mint — “Share & Earn”

When the OWNED banner is shown, display the referral link
`` `${location.origin}/?ref=${tokenId}` `` + a copy button. The X-intent text
now appends that link so every share a holder posts becomes a converting
referral link:

> Here's mine. Your turn if you're a real Monad… `cards.pradeeppilot.xyz/?ref=37`

Add an optional “Referral earned: X MON · Claim” line once `referralBalance` /
`claimReferralFees()` exist in the ABI (show only when balance > 0, using the
existing ethers/viem account).

### abi.js

Add: `mint(string,address)` (new signature), `referrerOf`, `referralBalance`,
`claimReferralFees`, `referralBps`, `royaltyInfo`.

---

## 4. Config / deploy

- Set `MINT_PRICE > 0` on mainnet (referral fee is `mintPrice * bps`; free test
  mint still records attribution, but the *stake* needs a price).
- Set `referralBps` (e.g. 1000) and `royaltyBps` (e.g. 500) post-deploy.
- New `CONTRACT_ADDRESS` in server `.env`; static-assets cache rule already
  keeps `/api/config` uncacheable and HTML uncached.
- Re-verify on MonadScan; update frontend ABI before building.

---

## 5. Hackathon tie-in (judging rubric)

- **Originality/Track (15%)**: attention → stake is explicit. Minting via a
  creator's link makes that creator money; selling their card pays them a
  royalty forever. Peer-to-peer economy, not a points badge.
- **Founder/Market (25%)**: new KPI = *referral graph growth* (tokenId → referrer
  is queryable on-chain, `referrerOf`). Referrer balance is claimable MON —
  demos instantly.
- **Technical (20%)**: small, standard surface (ERC2981 + pull-payments + one
  new mint param), fully tested.

## 6. Edge cases

- **Self-refer via second wallet** — blocked: `mintCount[referrer] > 0` means
  they must already own a Lanyard; one-per-wallet is immutable so a fresh
  wallet can't both be referrer and refer. A second *real* wallet referencing
  the first is a legitimate fan, not an exploit (still one mint each).
- **Referrer transfers card** — new mints no longer accrue to them (frontend
  resolves `ownerOf` at mint time; the transferred-away token id stays in the
  URL but `mintCount` in old wallet still > 0, so they may still get fees via
  address if referenced — fine).
- **Fee when mintPrice = 0** — fee is 0, attribution still recorded on-chain.
- **Referrer wallet is a contract** — pull-payment `claim` can revert for a
  contract without a `receive()`; acceptable (they just can't claim).
- **metdata_attributes duplication** — bake already pins metaJson; adding a
  trait changes the CID deterministically (content addressing), no risk.