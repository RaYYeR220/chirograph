// Rebalancing inventory between Bitcoin Cash and Base through THORChain.
//
// A solver that fills USDC -> PUSD swaps ends up long USDC and short PUSD; the reverse direction
// does the opposite. THORChain moves value between the chains without a custodian: BCH sent to its
// vault with a memo arrives as USDC on Base, and USDC deposited through its router arrives as BCH.
// The PUSD leg (BCH <-> PUSD) is a Cauldron swap on Bitcoin Cash.
//
// Every call checks THORChain's own halt flags first and refuses to send anything while the route
// is halted, and every quote is rejected if its fees exceed the caller's cap.
import { TransactionBuilder } from 'cashscript';
import { erc20Abi, type Address } from 'viem';
import { addressToBytecode } from '@chirograph/sdk';
import type { BchSide } from './bch.js';
import type { EvmSide } from './evm.js';

export const THORNODE = process.env.THORNODE_URL ?? 'https://gateway.liquify.com/chain/thorchain_api';
/**
 * THORNodes run by different operators, all of which must agree on halt flags, the vault and the router
 * before anything is sent. Override the extra nodes with THORNODE_CHECK_URLS (comma-separated).
 */
const CHECK_NODES = [...new Set([
  THORNODE,
  ...(process.env.THORNODE_CHECK_URLS ?? 'https://thorchain-thornode-lb-1.thorwallet.org').split(',').map((u) => u.trim()).filter(Boolean),
])];
/** Largest disagreement tolerated between the two independent BCH/USD prices. */
const PRICE_AGREEMENT = 0.02;
/** THORChain's router on Base. Pinned: a quote naming any other router is refused before any approval. */
export const THOR_BASE_ROUTER = (process.env.THOR_BASE_ROUTER ?? '0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4').toLowerCase();
/** Short asset codes THORChain may use in memos. */
const SHORT_CODES: Record<string, string> = { 'BCH.BCH': 'c' };
export const THOR_ASSETS = {
  bch: 'BCH.BCH',
  baseUsdc: 'BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913',
} as const;
/** THORChain counts every asset in 1e8 units. */
export const THOR_DECIMALS = 8;

export interface ThorQuote {
  inbound_address: string;
  router?: string;
  memo: string;
  expiry: number;
  expected_amount_out: string;
  recommended_min_amount_in?: string;
  dust_threshold?: string;
  total_swap_seconds?: number;
  fees: { asset: string; outbound: string; liquidity: string; total: string; total_bps: number; slippage_bps: number };
}

export interface RouteStatus { chain: string; halted: boolean; tradingPaused: boolean }

async function thor<T>(path: string, node = THORNODE): Promise<T> {
  const res = await fetch(`${node}/thorchain/${path}`, { headers: { 'x-client-id': 'chirograph' } });
  const body = await res.json() as T & { message?: string; error?: string };
  // A refused quote comes back as an object with a message and no inbound address.
  const refusedQuote = path.startsWith('quote') && !(body && typeof body === 'object' && 'inbound_address' in body);
  if (!res.ok || refusedQuote) throw new Error(`THORChain ${path.split('?')[0]}: ${body?.message ?? body?.error ?? res.status}`);
  return body;
}

/** Halt flags for the chains a route touches. A chain counts as halted if any check node says so. */
export async function routeStatus(chains: string[]): Promise<RouteStatus[]> {
  const lists = await Promise.all(CHECK_NODES.map((n) => thor<{ chain: string; halted?: boolean; chain_trading_paused?: boolean }[]>('inbound_addresses', n)));
  return chains.map((chain) => {
    const cs = lists.map((l) => l.find((i) => i.chain === chain));
    return { chain, halted: cs.some((c) => !c || !!c.halted), tradingPaused: cs.some((c) => !c || !!c.chain_trading_paused) };
  });
}

/**
 * BCH/USD from two sources outside THORChain. Both must answer and agree within 2%, or nothing is sent:
 * the price floor for a rebalance must not come from the same place as the quote it is checking.
 */
export async function bchUsd(): Promise<number> {
  const [gecko, kraken] = await Promise.all([
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd').then((r) => r.json())
      .then((d: { 'bitcoin-cash'?: { usd?: number } }) => d['bitcoin-cash']?.usd),
    fetch('https://api.kraken.com/0/public/Ticker?pair=BCHUSD').then((r) => r.json())
      .then((d: { result?: Record<string, { c?: string[] }> }) => Number(Object.values(d.result ?? {})[0]?.c?.[0])),
  ]);
  if (!gecko || !kraken || !Number.isFinite(kraken)) throw new Error('no independent BCH/USD price');
  if (Math.abs(gecko - kraken) / kraken > PRICE_AGREEMENT) throw new Error(`BCH/USD sources disagree: ${gecko} vs ${kraken}`);
  return (gecko + kraken) / 2;
}

/** Price a swap. `toleranceBps` bounds the total shortfall (fees plus slippage) baked into the memo. */
export async function quote(from: string, to: string, amount1e8: bigint, destination: string, toleranceBps?: number): Promise<ThorQuote> {
  const q = new URLSearchParams({ from_asset: from, to_asset: to, amount: amount1e8.toString(), destination });
  if (toleranceBps !== undefined) q.set('tolerance_bps', String(toleranceBps));
  return thor<ThorQuote>(`quote/swap?${q}`);
}

export type Direction = 'bch-to-base' | 'base-to-bch';
export interface Plan {
  direction: Direction;
  amountIn1e8: bigint;
  quote: ThorQuote;
  feeBps: number;
}

/**
 * Check the route and price a rebalance. Throws, without sending anything, if THORChain has either
 * chain halted or if fees exceed `maxFeeBps`.
 */
export async function plan(direction: Direction, amountIn1e8: bigint, bch: BchSide, base: EvmSide, maxFeeBps: number): Promise<Plan> {
  const status = await routeStatus(['BCH', 'BASE']);
  const blocked = status.filter((s) => s.halted || s.tradingPaused);
  if (blocked.length) throw new Error(`THORChain route closed: ${blocked.map((s) => `${s.chain} ${s.halted ? 'halted' : 'trading paused'}`).join(', ')}`);
  const [from, to, destination] = direction === 'bch-to-base'
    ? [THOR_ASSETS.bch, THOR_ASSETS.baseUsdc, base.account.address]
    : [THOR_ASSETS.baseUsdc, THOR_ASSETS.bch, bch.address.replace(/^bitcoincash:/, '')];
  if (CHECK_NODES.length < 2) throw new Error('at least two independent THORNodes are required (THORNODE_URL plus THORNODE_CHECK_URLS)');
  const q = await quote(from, to, amountIn1e8, destination, maxFeeBps);
  // What the input is worth in the output asset at an outside price (USDC counted as $1).
  const price = await bchUsd();
  const fairOut1e8 = direction === 'bch-to-base'
    ? BigInt(Math.floor(Number(amountIn1e8) * price))
    : BigInt(Math.floor(Number(amountIn1e8) / price));
  if (q.recommended_min_amount_in && amountIn1e8 < BigInt(q.recommended_min_amount_in)) {
    throw new Error(`amount below THORChain's recommended minimum of ${q.recommended_min_amount_in} (1e8 units)`);
  }
  if (q.fees.total_bps > maxFeeBps) throw new Error(`fees ${q.fees.total_bps} bps exceed the cap of ${maxFeeBps} bps`);
  await checkQuote(q, direction === 'bch-to-base' ? 'BCH' : 'BASE', to, destination, maxFeeBps, fairOut1e8);
  return { direction, amountIn1e8, quote: q, feeBps: q.fees.total_bps };
}

/**
 * Never send to an address only one response vouched for. The vault (and on EVM the router) must match
 * what every configured THORNode lists for the source chain, the router must be the pinned one, and the
 * memo must swap into the asset we asked for, pay only our own address, and carry a price limit no
 * looser than the fee cap.
 */
export async function checkQuote(q: ThorQuote, sourceChain: 'BCH' | 'BASE', toAsset: string, destination: string, maxFeeBps: number, fairOut1e8: bigint) {
  const norm = (a: string) => a.trim().toLowerCase().replace(/^bitcoincash:/, '');
  const lists = await Promise.all(CHECK_NODES.map((n) => thor<{ chain: string; address: string; router?: string }[]>('inbound_addresses', n)));
  for (const [i, list] of lists.entries()) {
    const entry = list.find((c) => c.chain === sourceChain);
    if (!entry || norm(entry.address) !== norm(q.inbound_address)) throw new Error(`vault ${q.inbound_address} is not the ${sourceChain} vault listed by ${CHECK_NODES[i]}`);
    if (sourceChain === 'BASE' && norm(entry.router ?? '') !== norm(q.router ?? '')) throw new Error(`router ${q.router} is not the one listed by ${CHECK_NODES[i]}`);
  }
  if (sourceChain === 'BASE' && norm(q.router ?? '') !== THOR_BASE_ROUTER) throw new Error(`router ${q.router} is not the pinned THORChain router ${THOR_BASE_ROUTER}`);

  const fields = q.memo.split(':');
  // Exactly action:asset:destination:limit. A fifth field would be an affiliate, which we never add.
  if (fields.length !== 4) throw new Error(`memo must have exactly four fields: ${q.memo}`);
  const [action, asset, dest, limitField] = fields;
  if (!['=', 's', 'swap'].includes((action ?? '').toLowerCase())) throw new Error(`memo is not a swap: ${q.memo}`);
  const assetOk = [toAsset, toAsset.split('-')[0], SHORT_CODES[toAsset]].filter(Boolean).map((a) => a!.toLowerCase()).includes((asset ?? '').toLowerCase());
  if (!assetOk) throw new Error(`memo swaps into ${asset}, expected ${toAsset}`);
  if (norm(dest ?? '') !== norm(destination)) throw new Error(`memo pays ${dest}, expected our own address ${destination}`);
  // LIMIT, or LIMIT/INTERVAL/QUANTITY for a streaming swap: at most 3 blocks apart, quantity chosen by THORChain.
  const [limitText = '', interval, quantity, ...extra] = (limitField ?? '').split('/');
  if (extra.length || (interval !== undefined && !(/^\d+$/.test(interval) && Number(interval) <= 3 && quantity === '0'))) {
    throw new Error(`unexpected streaming parameters in memo: ${limitField}`);
  }
  const m = /^(\d+)(?:e(\d+))?$/i.exec(limitText);
  const limit = m ? BigInt(m[1]!) * 10n ** BigInt(m[2] ?? 0) : 0n;
  // The floor comes from the outside price, not from the quote being checked.
  const floor = (fairOut1e8 * BigInt(10_000 - maxFeeBps)) / 10_000n;
  if (BigInt(q.expected_amount_out) < floor) throw new Error(`quoted output ${q.expected_amount_out} is below ${floor} (fair value less the fee cap)`);
  if (limit === 0n || limit < floor) throw new Error(`memo price limit ${limitText || 'missing'} is below ${floor} (fair value less the fee cap)`);
}

/** Send the inbound transaction for a plan. Returns the inbound transaction id to track. */
export async function execute(p: Plan, bch: BchSide, base: EvmSide): Promise<string> {
  if (p.direction === 'bch-to-base') {
    // BCH -> vault, with the swap memo in an OP_RETURN output.
    const sats = p.amountIn1e8; // BCH has 8 decimals, so 1e8 units are satoshis
    if (p.quote.dust_threshold && sats <= BigInt(p.quote.dust_threshold)) throw new Error('amount at or below the dust threshold');
    const utxos = (await bch.provider.getUtxos(bch.address)).filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
    const tx = new TransactionBuilder({ provider: bch.provider });
    let total = 0n;
    for (const u of utxos) {
      tx.addInput(u, bch.signer.unlockP2PKH());
      total += u.satoshis;
      if (total >= sats + 2_000n) break;
    }
    if (total < sats + 2_000n) throw new Error('not enough BCH outside token UTXOs');
    tx.addOutput({ to: addressToBytecode(`bitcoincash:${p.quote.inbound_address.replace(/^bitcoincash:/, '')}`), amount: sats })
      .addOpReturnOutput([p.quote.memo])
      .addBchChangeOutputIfNeeded({ to: addressToBytecode(bch.address), feeRate: 1 });
    return (await tx.send()).txid;
  }
  // USDC on Base -> THORChain router, which forwards it to the vault with the memo.
  if (!p.quote.router) throw new Error('quote has no router for an EVM deposit');
  const usdc6 = p.amountIn1e8 / 100n; // 1e8 -> USDC's 6 decimals
  const router = p.quote.router as Address;
  const usdc = base.chain.usdc as Address;
  const approve = await base.wallet.writeContract({
    address: usdc, abi: erc20Abi, functionName: 'approve', args: [router, usdc6], chain: base.wallet.chain, account: base.account,
  });
  await base.pub.waitForTransactionReceipt({ hash: approve });
  const hash = await base.wallet.writeContract({
    address: router, abi: routerAbi, functionName: 'depositWithExpiry',
    args: [p.quote.inbound_address as Address, usdc, usdc6, p.quote.memo, BigInt(p.quote.expiry)],
    chain: base.wallet.chain, account: base.account,
  });
  const receipt = await base.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`router deposit reverted: ${hash}`);
  return hash;
}

/** THORChain's view of an inbound transaction: observed, swapped, and whether the outbound has gone out. */
export async function track(txid: string): Promise<{ done: boolean; stages: Record<string, unknown>; outTxs: unknown }> {
  const id = txid.replace(/^0x/, '').toUpperCase();
  const s = await thor<{ stages?: Record<string, { completed?: boolean }>; out_txs?: unknown }>(`tx/status/${id}`);
  const stages = s.stages ?? {};
  const done = !!(stages.outbound_signed as { completed?: boolean } | undefined)?.completed
    || ((stages.swap_status as { pending?: boolean } | undefined)?.pending === false && !!s.out_txs);
  return { done, stages, outTxs: s.out_txs };
}

const routerAbi = [{
  type: 'function', name: 'depositWithExpiry', stateMutability: 'payable',
  inputs: [
    { name: 'vault', type: 'address' }, { name: 'asset', type: 'address' }, { name: 'amount', type: 'uint256' },
    { name: 'memo', type: 'string' }, { name: 'expiration', type: 'uint256' },
  ],
  outputs: [],
}] as const satisfies readonly unknown[];

