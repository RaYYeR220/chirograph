import { EVM_CHAINS, MUSD_CATEGORY, PUSD_CATEGORY, type EvmChainKey, type BchNetwork, type StableSymbol } from '@chirograph/sdk';
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
  /**
   * Extra RPCs tried when `rpc` fails. Off unless the operator lists them: every endpoint here is
   * trusted for the reads that decide settlement, so adding one is a deliberate choice.
   */
  rpcFallbacks: string[];
  usdc: Address;
  htlc: Address;
  explorer: string;
  /** Blocks to wait on the user's EVM lock before locking BCH. */
  confirmations: number;
  /** Block the escrow was deployed in; event scans start here. */
  deployBlock?: number;
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
  /** Smallest swap accepted (cents); keeps abandoned swaps from tying up inventory for free. */
  minSwap: number;
  /** Total unconfirmed 0-conf exposure (cents) across all open PUSD -> USDC swaps. */
  instantExposureMax: number;
  /** BCH kept back for fees; capacity drops to zero below it. */
  satsReserve: bigint;
  pollMs: number;
  /** Token category the solver trades on BCH (PUSD on mainnet, a test token on chipnet). */
  /** PUSD's category (or the chipnet stand-in). */
  tokenCategory: string;
  /** Every token this solver trades, by symbol. A symbol without a category is not offered. */
  tokens: Partial<Record<StableSymbol, string>>;
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
      rpcFallbacks: (process.env[`${upper}_RPC_FALLBACKS`] ?? '').split(',').map((u) => u.trim()).filter(Boolean),
      usdc: (process.env[`${upper}_USDC`] ?? base.usdc) as Address,
      htlc: env(`${upper}_HTLC`) as Address,
      explorer: base.explorer,
      confirmations: num(`${upper}_CONFIRMATIONS`, 1),
      deployBlock: num(`${upper}_DEPLOY_BLOCK`, 0),
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
    minSwap: num('MIN_SWAP_CENTS', 25),
    instantExposureMax: num('INSTANT_EXPOSURE_MAX_CENTS', 1_000),
    satsReserve: BigInt(num('SATS_RESERVE', 10_000)),
    pollMs: num('POLL_MS', 2_500),
    tokenCategory: env('TOKEN_CATEGORY', PUSD_CATEGORY),
    tokens: tokenMap(env('BCH_NETWORK', 'mainnet') as BchNetwork),
    publicName: env('SOLVER_NAME', 'Chirograph solver #1'),
  };
}

/**
 * PUSD always; MUSD on mainnet unless MUSD_CATEGORY is set to an empty string. On chipnet both are
 * test stand-ins: TOKEN_CATEGORY for PUSD and MUSD_CATEGORY for MUSD (MUSD is off when it is unset).
 */
function tokenMap(network: BchNetwork): Partial<Record<StableSymbol, string>> {
  const pusd = (process.env.TOKEN_CATEGORY ?? PUSD_CATEGORY).toLowerCase();
  const musdEnv = process.env.MUSD_CATEGORY;
  const musd = musdEnv !== undefined ? musdEnv.toLowerCase() : network === 'mainnet' ? MUSD_CATEGORY : '';
  return musd ? { PUSD: pusd, MUSD: musd } : { PUSD: pusd };
}
