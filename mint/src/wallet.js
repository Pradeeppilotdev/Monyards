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

export const appKitModal = HAS_APPKIT
  ? createAppKit({
      adapters: [new WagmiAdapter({ networks: [monadTestnet], projectId: PROJECT_ID, ssr: false })],
      networks: [monadTestnet],
      metadata: {
        name: 'Monad Lanyard',
        description: 'Interactive physics lanyard cards on Monad',
        url: typeof location !== 'undefined' ? location.origin : 'https://lanyard.monad',
        icons: [],
      },
      features: { analytics: false },
    })
  : null