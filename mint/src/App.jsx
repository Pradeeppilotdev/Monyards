import React, { useEffect, useMemo, useRef, useState } from 'react'
import Lanyard from '../../animation/src/Lanyard'
import { renderCardSvg } from '../../shared/card-svg'
import backCard from '../../animation/src/assets/back-card.svg'
import { abi } from './abi'
import { createPublicClient, createWalletClient, custom, formatEther, http } from 'viem'
import { recordShareClip } from './record'

const AVATAR = (handle) => `https://unavatar.io/x/${encodeURIComponent(handle)}`

function useDebounced(value, delay) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export default function App() {
  const [config, setConfig] = useState(null)
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [preview, setPreview] = useState(null)
  const [account, setAccount] = useState(null)
  const [mintPrice, setMintPrice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [recording, setRecording] = useState(false)
  const [clip, setClip] = useState(null)
  const driveRef = useRef(null)

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

  // Regenerate the live preview whenever the identity changes.
  useEffect(() => {
    let cancelled = false
    if (!trimmed && !name) return setPreview(null)
    renderCardSvg({ pfp: pfpUrl, username: trimmed, name })
      .then((front) => !cancelled && setPreview(front))
      .catch(() => !cancelled && setPreview(null))
    return () => (cancelled = true)
  }, [trimmed, name, pfpUrl])

  const { publicClient, chain } = useMemo(() => {
    if (!config) return {}
    const chain = {
      id: config.chainId,
      name: 'Monad',
      nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    }
    return { chain, publicClient: createPublicClient({ chain, transport: http(config.rpcUrl) }) }
  }, [config])

  useEffect(() => {
    if (!publicClient || !config?.contractAddress) return
    publicClient
      .readContract({ address: config.contractAddress, abi, functionName: 'mintPrice' })
      .then(setMintPrice)
      .catch(() => setMintPrice(null))
  }, [publicClient, config])

  async function connect() {
    try {
      if (!window.ethereum) throw new Error('No wallet found. Install MetaMask or Rabby.')
      const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' })
      setAccount(addr)
      if (chain && config?.contractAddress) {
        const price = await publicClient.readContract({
          address: config.contractAddress,
          abi,
          functionName: 'mintPrice',
        })
        setMintPrice(price)
      }
    } catch (e) {
      setError(e.message)
    }
  }

  async function mint() {
    setError(null)
    setResult(null)
    if (!config?.contractAddress) return setError('Contract not deployed yet — check back soon.')
    if (!account) return setError('Connect your wallet first.')
    setBusy(true)
    try {
      const res = await fetch('/api/bake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: trimmed || undefined,
          name: name || undefined,
          pfp: pfpUrl || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'bake failed')

      const walletClient = createWalletClient({ account, chain, transport: custom(window.ethereum) })
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
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const priceLabel = mintPrice != null ? formatEther(mintPrice) : '...'
  const txUrl = result && config ? `${config.explorer}/tx/${result.hash}` : null

  async function recordClip() {
    setRecording(true)
    setError(null)
    try {
      const canvas = document.querySelector('.preview canvas')
      if (!canvas) throw new Error('Preview canvas not found')
      const blob = await recordShareClip({ canvas, driveRef })
      setClip({ url: URL.createObjectURL(blob), mime: blob.type })
      return blob
    } catch (e) {
      setError('Clip recording failed: ' + e.message)
    } finally {
      setRecording(false)
    }
  }

  if (import.meta.env.DEV) window.__app = {
    recordClip,
    driveRef,
    fakeResult: () => {
      setAccount('0x68a691c461c54ce767c6d539022fa344397b9f31')
      setResult({ hash: '0x' + '0'.repeat(64), tokenURI: 'ipfs://x', animationUrl: 'ipfs://y' })
    },
  }

  return (
    <div className="page">
      <div className="panel">
        <div className="brand">
          <span className="brand-mark" />
          <span>MONAD LANYARD</span>
        </div>
        <h1>Mint your lanyard card</h1>
        <p className="sub">
          Enter an X handle and get an interactive, physics-powered lanyard card on-chain — fully on IPFS, no external
          requests.
        </p>

        <label className="field">
          <span>X handle</span>
          <div className="row">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="vitalik"
              autoCapitalize="none"
              spellCheck={false}
            />
            {pfpUrl && (
              <img
                className="avatar"
                src={pfpUrl}
                alt=""
                onError={(e) => (e.currentTarget.style.opacity = 0)}
              />
            )}
          </div>
        </label>

        <label className="field">
          <span>Display name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vitalik" />
        </label>

        {!config?.contractAddress && (
          <div className="warn">Contract not deployed yet — you can preview, minting opens soon.</div>
        )}

        {account ? (
          <div className="wallet-row">
            <span className="dot" />
            {account.slice(0, 6)}…{account.slice(-4)}
          </div>
        ) : (
          <button className="btn secondary" onClick={connect}>
            Connect wallet
          </button>
        )}

        <button className="btn primary" disabled={busy || !account} onClick={mint}>
          {busy ? 'Baking + minting…' : `Mint — ${priceLabel} MON`}
        </button>

        {error && <div className="error">{error}</div>}

        {result && (
          <div className="success">
            <p className="success-title">Minted! Your card is on-chain.</p>
            <p className="success-sub">
              Token minted to {account.slice(0, 6)}…{account.slice(-4)}. Record a clip and post it — that's how this
              thing spreads.
            </p>
            <a className="tx-link" href={txUrl} target="_blank" rel="noreferrer">
              View transaction →
            </a>
            <div className="clip-area">
              {clip ? (
                <>
                  <video className="clip-video" src={clip.url} controls loop muted />
                  <a className="btn secondary" href={clip.url} download={`lanyard-${trimmed || 'card'}.webm`}>
                    Download clip
                  </a>
                </>
              ) : (
                <button className="btn primary" onClick={recordClip} disabled={recording}>
                  {recording ? 'Recording…' : 'Record share clip'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="preview">
        {preview ? (
          <Lanyard
            position={[0, 0, 20]}
            gravity={[0, -40, 0]}
            fov={26}
            frontImage={preview}
            backImage={backCard}
            imageFit="cover"
            lanyardWidth={0.5}
            driveRef={driveRef}
          />
        ) : (
          <div className="preview-empty">Your card preview appears here — type a handle.</div>
        )}
      </div>
    </div>
  )
}