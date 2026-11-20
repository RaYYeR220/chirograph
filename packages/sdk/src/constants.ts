import type { Address, Hex } from 'viem';

/** ParyonUSD (PUSD) fungible CashToken on Bitcoin Cash mainnet. 2 decimals: 1 base unit = 0.01 PUSD. */
export const PUSD_CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
export const PUSD_DECIMALS = 2;
/** MoriaUSD (MUSD), Bitcoin Cash's other dollar CashToken. Also 2 decimals, so 1 unit = $0.01 too. */
export const MUSD_CATEGORY = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366';

/** The Bitcoin Cash dollars a swap can deliver or take. The lock covenant works for any fungible CashToken. */
export type StableSymbol = 'PUSD' | 'MUSD';
export const STABLES: Record<StableSymbol, { symbol: StableSymbol; name: string; category: string }> = {
  PUSD: { symbol: 'PUSD', name: 'ParyonUSD', category: PUSD_CATEGORY },
  MUSD: { symbol: 'MUSD', name: 'MoriaUSD', category: MUSD_CATEGORY },
};
/** USDC uses 6 decimals on every EVM chain we support. */
export const USDC_DECIMALS = 6;
/** 1 PUSD base unit (0.01) = 10_000 USDC base units (0.000001). */
export const USDC_UNITS_PER_PUSD_UNIT = 10_000n;

/** Satoshis carried by every lock UTXO; they pay the keyless claim or refund fee. */
export const LOCK_SATS = 2_000n;
/** The most any executor may take from a lock UTXO as miner fee. Enforced by the covenant. */
export const MAX_EXECUTOR_FEE = 1_000n;
/** Fee we actually spend on a single-input keyless claim/refund (~300 bytes at 1 sat/byte, rounded up). */
export const KEYLESS_SPEND_FEE = 600n;

/**
 * Timelocks. The side that holds the secret locks first and gets the longer timeout, so the
 * counterparty always has time to reuse the revealed secret before the initiator can refund.
 *
 * BCH timelocks are checked against median time past, which trails wall-clock time by roughly an
 * hour on a 10-minute chain, so the BCH refund becomes possible about an hour later than the
 * nominal value. The margins below already account for that lag.
 */
export const TIMEOUTS = {
  /** USDC -> PUSD: user's EVM lock, the long side. */
  inEvmRefundSeconds: 4 * 3600,
  /** USDC -> PUSD: solver's BCH lock, the short side (effective ~2h with MTP lag). */
  inBchRefundSeconds: 1 * 3600,
  /** PUSD -> USDC: user's BCH lock, the long side (effective ~5h with MTP lag). */
  outBchRefundSeconds: 4 * 3600,
  /** PUSD -> USDC: solver's EVM lock, the short side. */
  outEvmRefundSeconds: 1 * 3600,
} as const;

export type EvmChainKey = 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'baseFork' | 'arbitrumFork' | 'baseSepolia' | 'arbitrumSepolia';
export type BchNetwork = 'mainnet' | 'chipnet';

export interface EvmChainConfig {
  key: EvmChainKey;
  chainId: number;
  name: string;
  usdc: Address;
  /** ChirographHTLC deployment; filled in per environment. */
  htlc?: Address;
  explorer: string;
  rpc: string;
  /** Other public endpoints tried when `rpc` fails (public RPCs drop requests now and then). */
  rpcFallbacks?: string[];
}

export const EVM_CHAINS: Record<EvmChainKey, EvmChainConfig> = {
  base: {
    key: 'base', chainId: 8453, name: 'Base',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    htlc: '0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7',
    explorer: 'https://basescan.org', rpc: 'https://mainnet.base.org',
    rpcFallbacks: ['https://base-rpc.publicnode.com', 'https://base.drpc.org'],
  },
  arbitrum: {
    key: 'arbitrum', chainId: 42161, name: 'Arbitrum',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    htlc: '0xF8CD07455A4AC40e1653cF2c7543c81f768FD5E7',
    explorer: 'https://arbiscan.io', rpc: 'https://arb1.arbitrum.io/rpc',
    rpcFallbacks: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'],
  },
  optimism: {
    key: 'optimism', chainId: 10, name: 'Optimism',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    explorer: 'https://optimistic.etherscan.io', rpc: 'https://optimism-rpc.publicnode.com',
    rpcFallbacks: ['https://mainnet.optimism.io', 'https://optimism.drpc.org'],
  },
  polygon: {
    key: 'polygon', chainId: 137, name: 'Polygon',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    explorer: 'https://polygonscan.com', rpc: 'https://polygon-bor-rpc.publicnode.com',
    rpcFallbacks: ['https://polygon.drpc.org'],
  },
  baseFork: {
    key: 'baseFork', chainId: 8453, name: 'Base (local fork)',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorer: 'https://basescan.org', rpc: 'http://127.0.0.1:8545',
  },
  arbitrumFork: {
    key: 'arbitrumFork', chainId: 42161, name: 'Arbitrum (local fork)',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    explorer: 'https://arbiscan.io', rpc: 'http://127.0.0.1:8546',
  },
  baseSepolia: {
    key: 'baseSepolia', chainId: 84532, name: 'Base Sepolia',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    explorer: 'https://sepolia.basescan.org', rpc: 'https://sepolia.base.org',
  },
  arbitrumSepolia: {
    key: 'arbitrumSepolia', chainId: 421614, name: 'Arbitrum Sepolia',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    explorer: 'https://sepolia.arbiscan.io', rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
  },
};

export const BCH_EXPLORER: Record<BchNetwork, string> = {
  mainnet: 'https://explorer.salemkode.com',
  chipnet: 'https://chipnet.chaingraph.cash',
};

export const ZERO_HASH: Hex = `0x${'00'.repeat(32)}`;
