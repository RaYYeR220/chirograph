import { EVM_CHAINS, type EvmChainKey, type BchNetwork } from '@chirograph/sdk';
import type { Address, Hex } from 'viem';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`missing env ${name}`);
  return v;
}
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export interface ChainRuntime {
  key: EvmChainKey;
  chainId: number;
  name: string;
  rpc: string;
  usdc: Address;
  htlc: Address;
  explorer: string;
  /** Blocks to wait on the user's EVM lock before locking BCH. */
  confirmations: number;
}

export interface SolverConfig {
  port: number;
  dbPath: string;
  bchNetwork: BchNetwork;
  electrumHost?: string;
  bchWif: string;
  evmKey: Hex;
  chains: ChainRuntime[];
  feeBps: number;
  minFee: number;
  /** Largest swap (cents) we fill against an unconfirmed BCH lock, after the double-spend-proof wait. */
  instantMax: number;
  /** Largest swap (cents) we accept at all. */
  swapMax: number;
  dsproofWaitMs: number;
  pollMs: number;
  /** Token category the solver trades on BCH (PUSD on mainnet, a test token on chipnet). */
  tokenCategory: string;
  publicName: string;
}

export function loadConfig(): SolverConfig {
  const chainKeys = env('CHAINS', 'base,arbitrum').split(',').map((s) => s.trim()) as EvmChainKey[];
  const chains = chainKeys.map((key) => {
    const base = EVM_CHAINS[key];
    if (!base) throw new Error(`unknown chain ${key}`);
    const upper = key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
    return {
      key,
      chainId: base.chainId,
      name: base.name,
      rpc: process.env[`${upper}_RPC_URL`] ?? base.rpc,
      usdc: (process.env[`${upper}_USDC`] ?? base.usdc) as Address,
      htlc: env(`${upper}_HTLC`) as Address,
      explorer: base.explorer,
      confirmations: num(`${upper}_CONFIRMATIONS`, 1),
    } satisfies ChainRuntime;
  });
  return {
    port: num('PORT', 8787),
    dbPath: env('DB_PATH', './chirograph.sqlite'),
    bchNetwork: env('BCH_NETWORK', 'mainnet') as BchNetwork,
    electrumHost: process.env.ELECTRUM_HOST,
    bchWif: env('BCH_WIF'),
    evmKey: env('EVM_PRIVATE_KEY') as Hex,
    chains,
    feeBps: num('FEE_BPS', 30),
    minFee: num('MIN_FEE_CENTS', 1),
    instantMax: num('INSTANT_MAX_CENTS', 500),
    swapMax: num('SWAP_MAX_CENTS', 2_000),
    dsproofWaitMs: num('DSPROOF_WAIT_MS', 4_000),
    pollMs: num('POLL_MS', 2_500),
    tokenCategory: env('TOKEN_CATEGORY', '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544'),
    publicName: env('SOLVER_NAME', 'Chirograph solver #1'),
  };
}
