import type { EvmChainKey } from './constants.js';

/** `in`: USDC on an EVM chain -> PUSD on Bitcoin Cash. `out`: PUSD -> USDC. */
export type Direction = 'in' | 'out';

/** Amounts in the API are always integer cents (1 = $0.01 = 1 PUSD base unit). */
export type Cents = number;

export type SwapStatus =
  | 'awaiting_user_lock'   // quote accepted, waiting for the user's lock
  | 'user_locked'          // user's funds are locked on the source chain
  | 'solver_locked'        // solver's funds are locked on the destination chain
  | 'secret_revealed'      // the user claimed: secret is public, user has their funds
  | 'completed'            // solver also claimed with the secret; swap is closed
  | 'refunded'             // timed out; both sides got their money back
  | 'failed';

export type Tier = 'instant' | 'confirmed';

export interface QuoteRequest {
  direction: Direction;
  chain: EvmChainKey;
  amount: Cents;
}

export interface Quote {
  direction: Direction;
  chain: EvmChainKey;
  amountIn: Cents;
  amountOut: Cents;
  fee: Cents;
  tier: Tier;
  /** Unix seconds after which this quote is no longer honoured. */
  expiresAt: number;
  solver: { bchAddress: string; bchTokenAddress: string; evmAddress: `0x${string}` };
  htlc: `0x${string}`;
  usdc: `0x${string}`;
  bchNetwork: 'mainnet' | 'chipnet';
}

export interface SolverInfo {
  name: string;
  bchNetwork: 'mainnet' | 'chipnet';
  chains: Array<{ key: EvmChainKey; chainId: number; htlc: `0x${string}`; usdc: `0x${string}`; explorer: string }>;
  feeBps: number;
  minFee: Cents;
  /** Largest single swap the solver can fill right now, per direction and chain. */
  capacity: Record<string, { in: Cents; out: Cents }>;
  instantTierMax: Cents;
  inventory: { pusd: Cents; bchSats: string; usdc: Record<string, Cents> };
  pusdCategory: string;
  version: string;
}

export interface TimelineEvent {
  at: number;
  event: string;
  chain?: 'bch' | EvmChainKey;
  txid?: string;
  note?: string;
}

export interface SwapRecord {
  id: string;
  direction: Direction;
  chain: EvmChainKey;
  status: SwapStatus;
  tier: Tier;
  amountIn: Cents;
  amountOut: Cents;
  fee: Cents;
  secretHash: string;
  secret?: string;
  user: { bchAddress?: string; evmAddress?: string };
  bch: { lockAddress: string; refundTime: number; claimBytecode: string; refundBytecode: string; lockTxid?: string; spendTxid?: string };
  evm: { htlc: string; lockId: string; refundTime: number; lockTx?: string; spendTx?: string };
  createdAt: number;
  updatedAt: number;
  timeline: TimelineEvent[];
}

/** Body for opening a USDC -> PUSD swap: the user's gasless lock authorization. */
export interface OpenInSwap {
  chain: EvmChainKey;
  amount: Cents;
  secretHash: string;
  userEvm: `0x${string}`;
  userBchAddress: string;
  evmRefundTime: number;
  validBefore: number;
  signature: `0x${string}`;
}

/** Body for opening a PUSD -> USDC swap, sent right after the user's BCH lock is broadcast. */
export interface OpenOutSwap {
  chain: EvmChainKey;
  amount: Cents;
  secretHash: string;
  userEvm: `0x${string}`;
  userBchAddress: string;
  bchRefundTime: number;
  lockTxid: string;
}

export class SolverClient {
  constructor(private base: string) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    return body as T;
  }

  info() { return this.req<SolverInfo>('/v1/info'); }
  quote(q: QuoteRequest) { return this.req<Quote>('/v1/quote', { method: 'POST', body: JSON.stringify(q) }); }
  openIn(body: OpenInSwap) { return this.req<SwapRecord>('/v1/swaps/in', { method: 'POST', body: JSON.stringify(body) }); }
  openOut(body: OpenOutSwap) { return this.req<SwapRecord>('/v1/swaps/out', { method: 'POST', body: JSON.stringify(body) }); }
  /** PUSD -> USDC: hand the secret to the relayer, which claims the USDC to the user (gasless). */
  reveal(id: string, secret: string) { return this.req<SwapRecord>(`/v1/swaps/${id}/reveal`, { method: 'POST', body: JSON.stringify({ secret }) }); }
  /** USDC -> PUSD: tell the solver about a claim the browser already broadcast. */
  claimed(id: string, txid: string) { return this.req<SwapRecord>(`/v1/swaps/${id}/claimed`, { method: 'POST', body: JSON.stringify({ txid }) }); }
  swap(id: string) { return this.req<SwapRecord>(`/v1/swaps/${id}`); }
  list(limit = 50) { return this.req<SwapRecord[]>(`/v1/swaps?limit=${limit}`); }
  events(id: string, onUpdate: (s: SwapRecord) => void): () => void {
    const es = new EventSource(`${this.base}/v1/swaps/${id}/events`);
    es.onmessage = (e) => onUpdate(JSON.parse(e.data) as SwapRecord);
    return () => es.close();
  }
}

export function quoteFee(amount: Cents, feeBps: number, minFee: Cents): Cents {
  return Math.max(minFee, Math.ceil((amount * feeBps) / 10_000));
}
