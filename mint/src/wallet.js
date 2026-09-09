// mint/src/wallet.js — Reown AppKit (WalletConnect) setup.
//
// With VITE_REOWN_PROJECT_ID set (from cloud.reown.com), the connect button
// opens the AppKit modal: injected wallets + WalletConnect + QR. Without it,
// the app falls back to plain injected (window.ethereum) so dev stays simple.
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { defineChain } from 'viem'

export const PROJECT_ID = import.meta.env.VITE_REOWN_PROJECT_ID || ''
export const HAS_APPKIT = Boolean(PROJECT_ID)

// Network is build-time configurable so the same bundle can target Monad
// Mainnet (143) or Testnet (10143). Defaults to testnet.
const NETWORK_ID = Number(import.meta.env.VITE_CHAIN_ID || 10143)
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz'
const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL || 'https://testnet.monadscan.com'

export function makeMonadChain({ id = NETWORK_ID, rpcUrl = RPC_URL, explorer = EXPLORER_URL } = {}) {
  return defineChain({
    id,
    name: id === 10143 ? 'Monad Testnet' : 'Monad',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'MonadScan', url: explorer } },
  })
}

export const monadChain = makeMonadChain()

const metadata = {
  name: 'Monad Lanyard',
  description: 'Interactive physics lanyard cards on Monad',
  url: typeof location !== 'undefined' ? location.origin : 'https://lanyard.monad',
  icons: [],
}

// Adapter is created unconditionally so WagmiProvider always has a config —
// AppKit modal only activates when PROJECT_ID is set (mirrors ArcProof).
export const wagmiAdapter = new WagmiAdapter({
  networks: [monadChain],
  projectId: HAS_APPKIT ? PROJECT_ID : '00000000000000000000000000000000',
  ssr: false,
})

export const appKitModal = HAS_APPKIT
  ? createAppKit({
      adapters: [wagmiAdapter],
      networks: [monadChain],
      projectId: PROJECT_ID,
      metadata,
      features: { analytics: false },
    })
  : null