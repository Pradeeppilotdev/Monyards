// LanyardNFT ABI — the subset the mint frontend needs (mint, mintPrice, totalSupply).
export const abi = [
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'payable',
    inputs: [{ name: 'uri', type: 'string' }],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mintPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mintEnabled',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
]