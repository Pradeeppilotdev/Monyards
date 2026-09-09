import React, { useEffect, useMemo, useRef, useState } from 'react'
import Lanyard from '../../animation/src/Lanyard'
import { renderCardSvg, CARD_W, CARD_H } from '../../shared/card-svg'
import { previewCamera } from '../../animation/src/camera'
import backCard from '../../animation/src/assets/back-card.svg'
import { abi } from './abi'
import { HAS_APPKIT, PROJECT_ID, appKitModal, makeMonadChain } from './wallet'
import { createPublicClient, createWalletClient, custom, formatEther, http, parseEventLogs } from 'viem'
import { waitForTransactionReceipt } from 'viem/actions'
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

// Users don't read stack traces. Cancellations say nothing; everything else
// gets one soft line. Real details stay in the console.
function friendlyError(e) {
  const msg = String(e?.shortMessage || e?.message || e || '')
  console.error(e)
  if (/reject|denied|4001|user cancelled/i.test(msg)) return null // they know
  if (/Too many bakes/i.test(msg)) return 'Too many at once — give it a few minutes.'
  if (/insufficient/i.test(msg)) return 'Not enough test MON in that wallet for the mint.'
  if (/already minted/i.test(msg)) return 'This wallet already minted its Lanyard — one per wallet, forever.'
  return "Didn't go through — give it another go."
}

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

const CameraIcon = (props) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const VideoIcon = (props) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M23 7l-7 5 7 5V7z" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
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
  const [minted, setMinted] = useState(null) // null=unknown, true/false once checked
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [result, setResult] = useState(null)
  const [recording, setRecording] = useState(false)
  const [clip, setClip] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [bakeSecs, setBakeSecs] = useState(0)
  const [shareHint, setShareHint] = useState(null)
  const [xIntent, setXIntent] = useState(null)
  const [xLeaving, setXLeaving] = useState(false)
  const [touched, setTouched] = useState(false)
  // Referral: ?ref=<tokenId> — the referring Lanyard's token. Validated
  // against the chain (ownerOf must exist) before being passed to mint.
  const [refTokenId, setRefTokenId] = useState(null) // validated integer or null
  const [refInfo, setRefInfo] = useState(null) // {handle, displayName} for the chip
  const [referrerOfRef, setReferrerOfRef] = useState(null) // ownerOf(refTokenId)
  const [myTokenId, setMyTokenId] = useState(null) // my token after mint
  const [myReferralLink, setMyReferralLink] = useState(null)
  const [refEarnings, setRefEarnings] = useState(null) // my claimable referral balance
  const [refClaiming, setRefClaiming] = useState(false)
  const providerRef = useRef(null)
  const panelRef = useRef(null)
  const successRef = useRef(null)
  const recControllerRef = useRef(null)
  const [cam] = useState(() => previewCamera())
  // Scroll cue: show once per device until they actually scroll — localStorage
  // remembers across visits. (try/catch: private-mode storage can throw.)
  const [showCue, setShowCue] = useState(() => {
    try {
      return localStorage.getItem('lyrd-cue-seen') !== '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (!showCue) return
    const hide = () => {
      setShowCue(false)
      try {
        localStorage.setItem('lyrd-cue-seen', '1')
      } catch {}
      window.removeEventListener('scroll', hide)
    }
    window.addEventListener('scroll', hide, { passive: true })
    return () => window.removeEventListener('scroll', hide)
  }, [showCue])

  // Success popups are a moment, not furniture — fade after a few seconds.
  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), 8000)
    return () => clearTimeout(t)
  }, [result])

  // Same for errors — show, then get out of the way.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(t)
  }, [error])

  // Toast-style hints fade out on their own after a few seconds.
  useEffect(() => {
    if (!shareHint) return
    const t = setTimeout(() => setShareHint(null), 5000)
    return () => clearTimeout(t)
  }, [shareHint])

  // Live bake countdown — shows staging is working while it runs (counts down
// from the ~30s estimate inside the button label).
  useEffect(() => {
    if (!sharing) {
      setBakeSecs(0)
      return
    }
    const start = Date.now()
    const iv = setInterval(() => setBakeSecs(Math.floor((Date.now() - start) / 1000)), 500)
    return () => clearInterval(iv)
  }, [sharing])

  const debouncedHandle = useDebounced(handle, 600)
  const trimmed = debouncedHandle.replace(/^@/, '').trim()
  const pfpUrl = trimmed ? AVATAR(trimmed) : null

  // Fetch server config (chain, contract, explorer).
  useEffect(() => {
    let cancelled = false
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        if (cancelled) return
        setConfig(c)
        setConfigLoaded(true)
      })
      .catch((e) => {
        if (cancelled) return
        setConfigLoaded(true)
        setError('Could not load config: ' + e.message)
      })
    return () => (cancelled = true)
  }, [])

  // Live preview — mounts instantly with a default card, personalizes as they type.
  // Palette is extracted from the PFP so the card carries its color DNA.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const palette = pfpUrl ? await extractPalette(pfpUrl) : null
      if (cancelled) return
      setPfPalette(palette)
      const front = await renderCardSvg({ pfp: pfpUrl, username: trimmed, name, palette, chainId: config?.chainId })
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

  // Referral resolution: parse ?ref=<tokenId>, validate it's a real minted
  // token (ownerOf must succeed), and fetch its handle for the chip. If the
  // ref is invalid or self-owned we silently fall back to a normal mint.
  useEffect(() => {
    let cancelled = false
    const raw = new URLSearchParams(window.location.search).get('ref')
    if (!raw || !/^\d+$/.test(raw) || !publicClient || !config?.contractAddress) {
      setRefTokenId(null)
      setRefInfo(null)
      setReferrerOfRef(null)
      return
    }
    const tokenId = Number(raw)
    setRefTokenId(tokenId)
    publicClient
      .readContract({ address: config.contractAddress, abi, functionName: 'ownerOf', args: [BigInt(tokenId)] })
      .then((owner) => {
        if (cancelled) return
        setReferrerOfRef(owner)
        return fetch(`/api/refinfo?tokenId=${tokenId}`)
          .then((r) => r.json())
          .then((d) => !cancelled && d?.info && setRefInfo(d.info))
      })
      .catch(() => {
        if (cancelled) return
        setRefTokenId(null)
        setRefInfo(null)
        setReferrerOfRef(null)
      })
    return () => (cancelled = true)
  }, [publicClient, config])

  // Once we know who's connected, check if they already minted — if so the
  // mint box becomes a "yours forever" state instead of offering another mint.
  useEffect(() => {
    if (!publicClient || !config?.contractAddress || !account) {
      setMinted(null)
      return
    }
    let cancelled = false
    publicClient
      .readContract({ address: config.contractAddress, abi, functionName: 'mintCount', args: [account] })
      .then((n) => !cancelled && setMinted(Boolean(n)))
      .catch(() => !cancelled && setMinted(false))

    // Referral balance for the OWNED banner — how much this wallet has earned
    // by driving mints. Claimable via claimReferralFees().
    publicClient
      .readContract({ address: config.contractAddress, abi, functionName: 'referralBalance', args: [account] })
      .then((b) => !cancelled && b > 0n && setRefEarnings(b))
      .catch(() => !cancelled && setRefEarnings(null))
    return () => (cancelled = true)
  }, [publicClient, config, account])

  // The owned view links the user's minted token on MonadVision. The token id
  // comes from the Minted event after a fresh mint; on later visits we find it
  // by scanning minted ids (each wallet holds exactly one). Cached per wallet.
  useEffect(() => {
    if (!publicClient || !config?.contractAddress || !account || !minted || myTokenId != null) return
    const key = `lanyard-token-${account.toLowerCase()}`
    const cached = sessionStorage.getItem(key)
    if (cached != null) {
      setMyTokenId(Number(cached))
      return
    }
    let cancelled = false
    publicClient
      .readContract({ address: config.contractAddress, abi, functionName: 'totalSupply', args: [] })
      .then((supply) => {
        const max = Math.min(Number(supply), 512)
        const scan = async () => {
          for (let i = 0; i < max && !cancelled; i++) {
            const owner = await publicClient
              .readContract({ address: config.contractAddress, abi, functionName: 'ownerOf', args: [BigInt(i)] })
              .catch(() => null)
            if (owner && owner.toLowerCase() === account.toLowerCase()) {
              sessionStorage.setItem(key, String(i))
              setMyTokenId(i)
              return
            }
          }
        }
        scan().catch(() => {})
      })
      .catch(() => {})
    return () => (cancelled = true)
  }, [publicClient, config, account, minted, myTokenId])

  // The success card renders below the fold at the bottom of the panel — bring
  // it on screen so the tx link is actually seen after a mint/claim.
  useEffect(() => {
    if (!result) return
    const t = requestAnimationFrame(() => {
      successRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => cancelAnimationFrame(t)
  }, [result])

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
    // On mobile, scroll to the top so the user sees the card and knows to
    // drag it while recording.
    if (window.innerWidth <= 920) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setRecording(true)
    setError(null)
    const ctl = new AbortController()
    recControllerRef.current = ctl
    try {
      const canvas = document.querySelector('.preview canvas')
      if (!canvas) throw new Error('Preview canvas not found')
      const blob = await recordShareClip({ canvas, signal: ctl.signal })
      setClip({ blob, url: URL.createObjectURL(blob), mime: blob.type })
    } catch (e) {
      if (e.name !== 'AbortError') setError(friendlyError(e))
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

  // Dismissing the share CTA fades it out rather than snapping it away.
  function dismissX() {
    setXLeaving(true)
  }

  // One click: capture the lanyard scene (card, rope, silk) as the poster
  // image and save it straight to Downloads — same framing as the share pic.
  async function downloadPhoto() {
    try {
      const canvas = document.querySelector('.preview canvas')
      if (!canvas) throw new Error('Preview canvas not found')
      const blob = await captureLanyardImage({ canvas })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lanyard-${trimmed || 'card'}.${blob.type === 'image/png' ? 'png' : 'jpg'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setShareHint('Photo downloaded — share it anywhere.')
    } catch (e) {
      setError(friendlyError(e))
    }
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
      if (data.cached) setShareHint(`@${data.handle} already has a card — reusing its link.`)
      const gateway = data.shareUrl || data.animationGateway || ipfsToGateway(data.animationUrl)
      // Post-mint, the shared link carries the minter's token id so their
      // audience mints via them — attention turns into referral earnings.
      const refLink = myTokenId != null ? `${location.origin}/?ref=${myTokenId}` : null
      const text = `here's mine — where's yours?\n\n${gateway}\n\ngrab your monad lanyard at → ${refLink || 'cards.pradeeppilot.xyz'}`

      // Mobile: native share sheet — one tap, pick X, done.
      try {
        const ext = pngBlob.type === 'image/png' ? 'png' : 'jpg'
        const file = new File([pngBlob], `lanyard-${trimmed || 'card'}.${ext}`, { type: pngBlob.type })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text })
          setShareHint('Shared!')
          return
        }
      } catch (e) {
        if (e.name === 'AbortError') return
      }

      // Desktop: open the X composer directly — the card and link are staged in
      // the tweet, no clipboard round-trip needed. Browsers block popups after
      // async work, so the highlighted CTA below stays a real click.
      const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`
      setXIntent(intent)
      setXLeaving(false)
    } catch (e) {
      setError(friendlyError(e))
      console.error(e)
    } finally {
      setSharing(false)
    }
  }

  async function mint() {
    setError(null)
    setResult(null)
    if (!configLoaded) return // config still loading — mint button is disabled
    if (!config?.contractAddress) return setError('Contract not deployed yet — check back soon.')
    if (!account) return setError('Connect your wallet first.')
    setBusy(true)
    try {
      // Pre-flight the one-per-wallet rule so the wallet never silently fails
      // its fee estimation (the revert would show no gas and confuse users).
      const mintCount = await publicClient.readContract({
        address: config.contractAddress,
        abi,
        functionName: 'mintCount',
        args: [account],
      })
      if (mintCount > 0) {
        setError('This wallet already minted its Lanyard — one per wallet, forever.')
        return
      }
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
          refTokenId: refTokenId ?? undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'bake failed')

      const eth = await getProvider()
      const walletClient = createWalletClient({ account, chain: makeMonadChain({ id: config.chainId, rpcUrl: config.rpcUrl, explorer: config.explorer }), transport: custom(eth) })
      // The contract re-validates on-chain: self-refer reverted, non-holder
      // referrer reverted — so pass the validated referrer, address(0) if none.
      const referrer = referrerOfRef && referrerOfRef.toLowerCase() !== account.toLowerCase() ? referrerOfRef : '0x0000000000000000000000000000000000000000'
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi,
        functionName: 'mint',
        args: [data.tokenURI, referrer],
        value: mintPrice ?? 0n,
        account,
      })
      // Flag the share as minted so the server's prune never unpins a live
      // token's content. Include the tokenId so the referral chain resolves.
      if (data.shareId) {
        waitForTransactionReceipt(publicClient, { hash })
          .then((receipt) => {
            const [mintLog] = parseEventLogs({ abi, logs: receipt.logs, eventName: 'Minted' })
            const tokenId = Number(mintLog?.args?.tokenId ?? 0)
            if (tokenId > 0) {
              setMyTokenId(tokenId)
              setMyReferralLink(`${location.origin}/?ref=${tokenId}`)
              fetch('/api/minted', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ shareId: data.shareId, tokenId }),
              }).catch(() => {})
            }
          })
          .catch(() => {})
      }
      setMinted(true)
      setResult({ hash, tokenURI: data.tokenURI, animationUrl: data.animationUrl })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function claimReferral() {
    if (!account || refEarnings == null) return
    setRefClaiming(true)
    setError(null)
    try {
      const eth = await getProvider()
      const walletClient = createWalletClient({ account, chain: makeMonadChain({ id: config.chainId, rpcUrl: config.rpcUrl, explorer: config.explorer }), transport: custom(eth) })
      const hash = await walletClient.writeContract({
        address: config.contractAddress,
        abi,
        functionName: 'claimReferralFees',
        account,
      })
      setRefEarnings(0n)
      setResult({ hash, tokenURI: null, animationUrl: null })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setRefClaiming(false)
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
      {/* Floating brand — wide screens only (≥1420px), where the top-left
          corner is clear of the panel. Narrower viewports render the in-panel
          pill instead (CSS toggles). */}
      <header className="topbar">
        <div className="brand float-brand">
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
        <div className="brand top-brand">
          <span className="brand-mark" />
          <span>MONAD LYRD</span>
        </div>
        <h1>
          <span className="og-long">
            Are you a real <span className="grad shimmer">Monad OG?</span>
          </span>
          <span className="og-short">
            Real Monad OG? <span className="grad shimmer">Prove it.</span>
          </span>
        </h1>
        <p className="sub">Type your handle. Grab your card. Show it off.</p>

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

        <button
          className="btn x-btn shimmer-btn"
          onClick={shareOnX}
          disabled={sharing || !trimmed}
          title={trimmed ? undefined : 'Type your handle first'}
          style={{ width: '100%', marginTop: 22 }}
        >
          {sharing ? `Baking… ~${Math.max(0, 30 - bakeSecs)}s` : 'Stage your post'}
        </button>
        <p className="micro">One click — your lanyard pic + live link, staged for the post.</p>

        <div className="media-actions">
          <button className="btn photo-btn" onClick={downloadPhoto} disabled={!preview} style={{ width: '100%' }}>
            <CameraIcon />
            <span>Photo</span>
          </button>
          <button
            className={`btn record-ghost ${recording ? 'recording' : ''}`}
            onClick={recordClip}
            style={{ width: '100%' }}
          >
            <VideoIcon />
            <span>{recording ? 'Stop recording' : 'Record a loop'}</span>
          </button>
        </div>

        {xIntent && (
          <div
            className={`x-cta ${xLeaving ? 'x-cta--leave' : ''}`}
            onAnimationEnd={() => {
              if (xLeaving) {
                setXIntent(null)
                setXLeaving(false)
              }
            }}
          >
            <button
              className="x-cta-close"
              onClick={dismissX}
              aria-label="Dismiss share prompt"
              title="Dismiss"
            >
              ✕
            </button>
            <a className="btn x-open" href={xIntent} target="_blank" rel="noreferrer">
              <span>Post on</span>
              <XIcon />
            </a>
            <p className="micro share-hint x-tip">
              The preview may take a moment to appear — just hit Post, the card shows on your tweet right away.
            </p>
          </div>
        )}
        {shareHint && <p className="micro share-hint share-hint--fade">{shareHint}</p>}

        <div className="divider">
          <span>make it permanent</span>
        </div>

        <p className="micro mint-pitch">
          Free to share. <b>Mint to make it forever.</b>
        </p>

        <div className="mint-box">
          {config && !config.contractAddress && (
            <div className="warn">Contract not deployed yet — preview and share work fine, minting opens soon.</div>
          )}

          {refInfo && refTokenId != null && !minted && (
            <div className="ref-chip">
              <span className="ref-chip-dot" />
              You're minting via <b>@{refInfo.handle || refInfo.displayName}</b>'s card — a share of your mint goes to them.
            </div>
          )}

          <div className="mint-actions">
            {minted ? (
              <div className="owned-banner">
                <div className="owned-top">
                  <span className="owned-badge">OWNED</span>
                  <div className="owned-actions">
                    {HAS_APPKIT ? (
                      <button
                        className="owned-wallet"
                        onClick={() => appKitModal.open()}
                        title="Wallet — account &amp; disconnect"
                      >
                        {account.slice(0, 6)}…{account.slice(-4)}
                      </button>
                    ) : (
                      <span className="owned-wallet non-interactive">{account.slice(0, 6)}…{account.slice(-4)}</span>
                    )}
                    {myTokenId != null && config && (
                      <a
                        className="owned-token"
                        href={`${config.explorer}/token/${config.contractAddress}?a=${myTokenId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        NFT #{myTokenId}
                      </a>
                    )}
                  </div>
                </div>
                <p className="owned-text">This wallet's Lanyard is minted — it's yours, forever.</p>
                {myReferralLink && (
                  <div className="owned-referral">
                    <span className="owned-ref-label">Share &amp; earn — referral link:</span>
                    <code className="owned-ref-link">{myReferralLink.replace(/^https?:\/\//, '')}</code>
                    <p className="micro share-hint">Anyone who mints via your link earns you a referral fee.</p>
                  </div>
                )}
                {refEarnings != null && (
                  <div className="owned-earnings">
                    <span>Referral earned: {formatEther(refEarnings)} MON</span>
                    <button className="btn ref-claim" onClick={claimReferral} disabled={refClaiming || refEarnings === 0n}>
                      {refClaiming ? 'Claiming…' : 'Claim'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {HAS_APPKIT ? (
                  <div className="wallet-lockup">
                    <button className="btn secondary wallet-btn" onClick={connect}>
                      {account ? (
                        <span>{account.slice(0, 6)}…{account.slice(-4)}</span>
                      ) : (
                        'Connect wallet'
                      )}
                    </button>
                  </div>
                ) : account ? (
                  <div className="wallet-lockup">
                    <div className="wallet-row">
                      {account.slice(0, 6)}…{account.slice(-4)}
                    </div>
                    {window.ethereum && (
                      <button className="disconnect-btn" onClick={() => setAccount(null)} title="Disconnect wallet">
                        Disconnect
                      </button>
                    )}
                  </div>
                ) : (
                  <button className="btn secondary wallet-btn" onClick={connect}>
                    Connect wallet
                  </button>
                )}

                <button className="btn primary mint-btn" disabled={busy || !account || !configLoaded} onClick={mint}>
                  {!configLoaded ? 'Loading…' : mintLabel}
                </button>
              </>
            )}
          </div>

          {error && <div className="error">{error}</div>}

          {result && (
            <div className="success" ref={successRef}>
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
          />
        )}
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
        <div className={`drag-hint ${touched && !recording ? 'drag-hint--hidden' : ''}`}>
          {recording ? 'Drag the card — make it swing' : "Grab the card — it's real physics"}
        </div>
        {showCue && (
          <div className="scroll-cue" aria-hidden>
            scroll — make it yours <span className="scroll-cue-arrow">↓</span>
          </div>
        )}
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