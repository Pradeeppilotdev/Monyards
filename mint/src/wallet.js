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

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
})

const metadata = {
  name: 'Monad Lanyard',
  description: 'Interactive physics lanyard cards on Monad',
  url: typeof location !== 'undefined' ? location.origin : 'https://lanyard.monad',
  icons: [],
}

// Adapter is created unconditionally so WagmiProvider always has a config —
// AppKit modal only activates when PROJECT_ID is set (mirrors ArcProof).
export const wagmiAdapter = new WagmiAdapter({
  networks: [monadTestnet],
  projectId: HAS_APPKIT ? PROJECT_ID : '00000000000000000000000000000000',
  ssr: false,
})

export const appKitModal = HAS_APPKIT
  ? createAppKit({
      adapters: [wagmiAdapter],
      networks: [monadTestnet],
      projectId: PROJECT_ID,
      metadata,
      features: { analytics: false },
    })
  : null