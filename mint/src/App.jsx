import React, { useEffect, useMemo, useRef, useState } from 'react'
import Lanyard from '../../animation/src/Lanyard'
import { renderCardSvg, CARD_W, CARD_H } from '../../shared/card-svg'
import { previewCamera } from '../../animation/src/camera'
import backCard from '../../animation/src/assets/back-card.svg'
import { abi } from './abi'
import { HAS_APPKIT, PROJECT_ID, appKitModal, monadTestnet } from './wallet'
import { createPublicClient, createWalletClient, custom, formatEther, http } from 'viem'
import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import { recordShareClip, captureLanyardImage } from './record'
import Silk from '../../animation/src/Silk'

const AVATAR = (handle) => `https://unavatar.io/x/${encodeURIComponent(handle)}`

function useDebounced(value, delay) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

function ipfsToGateway(ipfsUrl) {
  if (!ipfsUrl) return null
  const cid = ipfsUrl.replace('ipfs://', '')
  // gateway.pinata.cloud: CORS-enabled + no cold-cache 504s (ipfs.io has both)
  return `https://gateway.pinata.cloud/ipfs/${cid}`
}

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })

// Rasterize the card SVG to a PNG blob. X can't embed SVG and many wallets
// won't render it either, so the share flow always ships a real PNG.
async function rasterizeCard(svgDataUrl, width = 1200) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('card render failed'))
    im.src = svgDataUrl
    setTimeout(() => reject(new Error('card render timeout')), 8000)
  })
  const c = document.createElement('canvas')
  c.width = width
  c.height = Math.round((width * CARD_H) / CARD_W)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return await new Promise((resolve, reject) =>
    // JPEG keeps gateway-cached images small enough that public ipfs
    // gateways can actually serve them (3.3MB PNGs 504 on their fetchers).
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85),
  )
}

// Extract a per-mint palette from the PFP: downscale to 24x24, pick the most
// vivid dominant color, then derive gradient stops + accent from it. The
// portrait color is always blended with Monad purple (#836EF9) first so every
// card stays on-brand while still carrying its portrait's color DNA. Fails
// soft — any error returns null and the card keeps its default violet.
async function extractPalette(imgUrl) {
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = imgUrl
      setTimeout(() => reject(new Error('pfp load timeout')), 8000)
    })
    const c = document.createElement('canvas')
    c.width = c.height = 24
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, 24, 24)
    const { data } = ctx.getImageData(0, 0, 24, 24)
    let best = null
    let bestScore = -1
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      if (a < 200) continue
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      // weight saturation + brightness toward vivid mids (avoid near-black/near-white)
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255
      const score = sat * 1.6 + (lum > 0.18 && lum < 0.85 ? 0.5 : 0)
      if (score > bestScore) { bestScore = score; best = [r, g, b] }
    }
    if (!best || bestScore < 0.25) return null // grayscale/dull pfp → keep default
    const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
    const DARK = [11, 6, 22]
    const MONAD_PURPLE = [131, 110, 249] // #836EF9 — every card stays rooted in the brand
    const base = mix(best, MONAD_PURPLE, 0.55)
    return {
      bgTop: hex(mix(base, DARK, 0.9)),
      bgMid: hex(mix(base, DARK, 0.7)),
      bgBottom: hex(mix(base, DARK, 0.4)),
      accent: hex(mix(base, [255, 255, 255], 0.15)),
    }
  } catch {
    return null
  }
}

const XIcon = (props) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

export default function App() {
  const [config, setConfig] = useState(null)
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState(null)
  const [pfPalette, setPfPalette] = useState(null)
  const [account, setAccount] = useState(null)
  const [mintPrice, setMintPrice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [recording, setRecording] = useState(false)
  const [clip, setClip] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [xIntent, setXIntent] = useState(null)
  const [shareHint, setShareHint] = useState(null)
  const [touched, setTouched] = useState(false)
  const driveRef = useRef(null)
  const providerRef = useRef(null)
  const panelRef = useRef(null)
  const recControllerRef = useRef(null)
  const [cam] = useState(() => previewCamera())

  const debouncedHandle = useDebounced(handle, 600)
  const trimmed = debouncedHandle.replace(/^@/, '').trim()
  const pfpUrl = trimmed ? AVATAR(trimmed) : null

  // Fetch server config (chain, contract, explorer).
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch((e) => setError('Could not load config: ' + e.message))
  }, [])

  // Live preview — mounts instantly with a default card, personalizes as they type.
  // Palette is extracted from the PFP so the card carries its color DNA.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const palette = pfpUrl ? await extractPalette(pfpUrl) : null
      if (cancelled) return
      setPfPalette(palette)
      const front = await renderCardSvg({ pfp: pfpUrl, username: trimmed, name, palette })
      if (!cancelled) setPreview(front)
    })()
    return () => (cancelled = true)
  }, [trimmed, name, pfpUrl])

  const publicClient = useMemo(() => {
    if (!config) return null
    const chain = {
      id: config.chainId,
      name: 'Monad',
      nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }
    return createPublicClient({ chain, transport: http(config.rpcUrl) })
  }, [config])

  useEffect(() => {
    if (!publicClient || !config?.contractAddress) return
    publicClient
      .readContract({ address: config.contractAddress, abi, functionName: 'mintPrice' })
      .then(setMintPrice)
      .catch(() => setMintPrice(null))
  }, [publicClient, config])

  async function getProvider() {
    if (HAS_APPKIT) {
      const p = providerRef.current
      if (!p) throw new Error('Connect your wallet first.')
      return p
    }
    if (!window.ethereum) throw new Error('No wallet found. Install MetaMask or Rabby.')
    return window.ethereum
  }

  async function connect() {
    try {
      if (HAS_APPKIT) return appKitModal.open()
      const eth = await getProvider()
      const [addr] = await eth.request({ method: 'eth_requestAccounts' })
      setAccount(addr)
    } catch (e) {
      setError(e.message)
    }
  }

  async function recordClip() {
    if (recording) {
      // Recording already in progress — treat the button as a cancel.
      recControllerRef.current?.abort()
      return
    }
    setRecording(true)
    setError(null)
    const ctl = new AbortController()
    recControllerRef.current = ctl
    try {
      const canvas = document.querySelector('.preview canvas')
      if (!canvas) throw new Error('Preview canvas not found')
      const blob = await recordShareClip({ canvas, driveRef, signal: ctl.signal })
      setClip({ blob, url: URL.createObjectURL(blob), mime: blob.type })
    } catch (e) {
      if (e.name !== 'AbortError') setError('Clip recording failed: ' + e.message)
    } finally {
      recControllerRef.current = null
      setRecording(false)
    }
  }

  function clearClip() {
    setClip((c) => {
      if (c) URL.revokeObjectURL(c.url)
      return null
    })
  }

  async function shareOnX() {
    setSharing(true)
    setError(null)
    setShareHint(null)
    setXIntent(null)
    try {
      if (!preview) throw new Error('card still rendering — try again in a second')

      // The share image is the WHOLE lanyard — card, rope and silk — not the
      // flat card. It also becomes the pinned og:image.
      let pngBlob
      try {
        pngBlob = await captureLanyardImage({ canvas: document.querySelector('.preview canvas') })
      } catch {}
      if (!pngBlob) pngBlob = await rasterizeCard(preview)
      const pngDataUrl = await blobToDataUrl(pngBlob)

      const res = await fetch('/api/bake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmed || undefined,
          name: name || undefined,
          pfp: pfpUrl || undefined,
          palette: pfPalette || undefined,
          shareImage: pngDataUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'bake failed')
      // Prefer the server's own share URL (PUBLIC_URL) — X unfurls it and it
      // doesn't depend on IPFS gateways being reachable.
      const gateway = data.shareUrl || data.animationGateway || ipfsToGateway(data.animationUrl)
      const handleTag = trimmed ? `@${trimmed}` : name || 'my card'
      const text = `${handleTag} printed a Monad Lanyard 🟣\nDrag it, swing it, mint yours 👇\n${gateway}`
      const fileName = `lanyard-${trimmed || 'card'}.png`

      // Mobile / supporting browsers: one tap — the native sheet opens with
      // the lanyard image and caption attached; pick X and post.
      try {
        const file = new File([pngBlob], fileName, { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text })
          return
        }
      } catch (e) {
        if (e.name === 'AbortError') return // user closed the share sheet
      }

      // Desktop: X has no one-click image API, so stage everything — lanyard
      // pic + caption + link land on the clipboard, composer opens, one paste
      // and it's ready to post. If the clipboard refuses, the image is
      // downloaded instead so attaching it stays one click away.
      let copied = false
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': pngBlob,
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ])
        copied = true
      } catch {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
          copied = true
        } catch {}
      }
      if (!copied) {
        const url = URL.createObjectURL(pngBlob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
      // No window.open here — browsers block popups after async work (Brave
      // especially). A real anchor the user clicks is a direct gesture, so
      // the composer opens every single time.
      const intent = `https://twitter.com/intent/tweet${copied ? '' : `?text=${encodeURIComponent(text)}`}`
      setXIntent(intent)
      setShareHint(
        copied
          ? 'Lanyard pic + caption + link are on your clipboard — open the composer, paste (Ctrl/Cmd+V) and post.'
          : 'Caption will be prefilled + the lanyard image was downloaded — attach it, then post.',
      )
    } catch (e) {
      setError('Share failed: ' + e.message)
    } finally {
      setSharing(false)
    }
  }

  async function mint() {
    setError(null)
    setResult(null)
    if (!config?.contractAddress) return setError('Contract not deployed yet — check back soon.')
    if (!account) return setError('Connect your wallet first.')
    setBusy(true)
    try {
      // Rasterize the card for the pinned static image — most wallets and
      // marketplaces can't render SVG.
      const pngDataUrl = preview ? await blobToDataUrl(await rasterizeCard(preview)) : undefined
      const res = await fetch('/api/bake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmed || undefined,
          name: name || undefined,
          pfp: pfpUrl || undefined,
          palette: pfPalette || undefined,
          shareImage: pngDataUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'bake failed')

      const eth = await getProvider()
      const walletClient = createWalletClient({ account, chain: monadTestnet, transport: custom(eth) })
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi,
        functionName: 'mint',
        args: [data.tokenURI],
        value: mintPrice ?? 0n,
        account,
      })
      setResult({ hash, tokenURI: data.tokenURI, animationUrl: data.animationUrl })
    } catch (e) {
      setError(e.shortMessage || e.message)
    } finally {
      setBusy(false)
    }
  }

  const isFree = mintPrice === 0n
  const priceLabel = mintPrice != null ? formatEther(mintPrice) : null
  const mintLabel = busy ? 'Minting…' : isFree ? 'Free mint' : priceLabel ? `Mint · ${priceLabel} MON` : 'Mint'
  const txUrl = result && config ? `${config.explorer}/tx/${result.hash}` : null

  if (import.meta.env.DEV)
    window.__app = {
      recordClip,
      shareOnX,
      driveRef,
      fakeResult: () => {
        setAccount('0x68a691c461c54ce767c6d539022fa344397b9f31')
        setResult({ hash: '0x' + '0'.repeat(64), tokenURI: 'ipfs://x', animationUrl: 'ipfs://y' })
      },
    }

  return (
    <>
      <div className="silk-bg" aria-hidden>
        <Silk color="#7325B5" speed={5} scale={1} noiseIntensity={1.5} rotation={0} />
      </div>
      <header className="topbar">
        <div className="brand top-brand">
          <span className="brand-mark" />
          <span>MONAD LYRD</span>
        </div>
      </header>
      <div className="page">
      {HAS_APPKIT && <AppKitBridge setAccount={setAccount} providerRef={providerRef} />}
      <div
        className="panel"
        ref={panelRef}
        onMouseMove={(e) => {
          const r = panelRef.current?.getBoundingClientRect()
          if (!r) return
          panelRef.current.style.setProperty('--mx', `${e.clientX - r.left}px`)
          panelRef.current.style.setProperty('--my', `${e.clientY - r.top}px`)
        }}
      >
        <h1>
          Your card is <span className="grad shimmer">live</span>
        </h1>
        <p className="sub">Type an X handle to make it yours. Drag it, swing it, share it — no wallet needed.</p>

        <label className="field">
          <span>Handle</span>
          <div className="control">
            <span className="control-icon">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="vitalik"
              autoCapitalize="none"
              spellCheck={false}
            />
            {pfpUrl && (
              <img className="avatar" src={pfpUrl} alt="" onError={(e) => (e.currentTarget.style.opacity = 0)} />
            )}
          </div>
        </label>

        <label className="field">
          <span>Display name</span>
          <div className="control">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </div>
        </label>

        <button className="btn x-btn shimmer-btn" onClick={shareOnX} disabled={sharing} style={{ width: '100%', marginTop: 22 }}>
          <XIcon />
          <span>{sharing ? 'Baking…' : 'Share on X'}</span>
        </button>
        <p className="micro">One click — your lanyard pic + live link, staged for the post.</p>
        {shareHint && <p className="micro share-hint">{shareHint}</p>}

        <button
          className={`btn record-ghost ${recording ? 'recording' : ''}`}
          onClick={recordClip}
          style={{ width: '100%', marginTop: 12 }}
        >
          {recording ? '■ Stop recording' : '○ Record a loop of your card'}
        </button>

        {clip && (
          <div className="clip-area">
            <button className="clip-close" onClick={clearClip} title="Discard clip" aria-label="Discard clip">
              ✕
            </button>
            <video className="clip-video" src={clip.url} controls loop muted playsInline />
            <a className="save-link" href={clip.url} download={`lanyard-${trimmed || 'card'}.webm`}>
              or download the video ↓
            </a>
          </div>
        )}

        {xIntent && (
          <a className="btn x-open" href={xIntent} target="_blank" rel="noreferrer">
            Open X composer →
          </a>
        )}

        <div className="divider">
          <span>make it permanent</span>
        </div>

        <p className="micro mint-pitch">
          Sharing is free. <b>Minting</b> puts your lanyard on-chain forever — your card, your
          handle, in your wallet and on marketplaces, still drag-it-live straight from the token
          page.
        </p>

        <div className="mint-box">
          {!config?.contractAddress && (
            <div className="warn">Contract not deployed yet — preview and share work fine, minting opens soon.</div>
          )}

          <div className="mint-actions">
            {HAS_APPKIT ? (
              <button className="btn secondary wallet-btn" onClick={connect}>
                {account ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className="dot" />
                    {account.slice(0, 6)}…{account.slice(-4)}
                  </span>
                ) : (
                  'Connect wallet'
                )}
              </button>
            ) : account ? (
              <div className="wallet-row">
                <span className="dot" />
                {account.slice(0, 6)}…{account.slice(-4)}
              </div>
            ) : (
              <button className="btn secondary wallet-btn" onClick={connect}>
                Connect wallet
              </button>
            )}

            <button className="btn primary mint-btn" disabled={busy || !account} onClick={mint}>
              {mintLabel}
            </button>
          </div>

          {error && <div className="error">{error}</div>}

          {result && (
            <div className="success">
              <p className="success-title">Minted! Your card is on-chain.</p>
              <p className="success-sub">
                Token minted to {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'your wallet'}.
              </p>
              <a className="tx-link" href={txUrl} target="_blank" rel="noreferrer">
                View transaction →
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="preview" onPointerDown={() => setTouched(true)}>
        {preview && (
          <Lanyard
            position={cam}
            gravity={[0, -40, 0]}
            fov={26}
            frontImage={preview}
            backImage={backCard}
            imageFit="cover"
            lanyardWidth={0.78}
            driveRef={driveRef}
          />
        )}
        <div className={`drag-hint ${touched ? 'drag-hint--hidden' : ''}`}>Grab the card — it&apos;s real physics</div>
        {recording && <div className="rec-badge">REC</div>}
      </div>
    </div>
    </>
  )
}

// AppKit hooks live in their own component so the legacy path never touches them.
function AppKitBridge({ setAccount, providerRef }) {
  const { address } = useAppKitAccount()
  const { walletProvider } = useAppKitProvider('eip155')
  useEffect(() => {
    setAccount(address || null)
  }, [address, setAccount])
  useEffect(() => {
    providerRef.current = walletProvider || null
  }, [walletProvider, providerRef])
  return null
}

export { AppKitBridge, PROJECT_ID }