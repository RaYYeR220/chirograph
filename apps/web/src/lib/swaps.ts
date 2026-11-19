import { binToHex, hexToBin } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { Address, Hex } from 'viem';
import {
  SolverClient, TIMEOUTS, LockState, addressToBytecode, buildKeylessSpend, buildWalletLockTx, findLockUtxo,
  generateSecret, hashSecret, htlcAbi, lockAuthorization, makeLockContract, to0x, usdcDomain,
  type BchLockParams, type Quote, type SolverInfo, type SwapRecord,
} from '@chirograph/sdk';
import { CONFIG, TRUST } from './config';
import { bchProvider, scanWallet, signAndBroadcast, waitForUtxo, type WalletSnapshot } from './bchWallet';
import { publicClient } from './evm';

export const solver = new SolverClient(CONFIG.solverUrl);
const now = () => Math.floor(Date.now() / 1000);
/** Minimum time left on the counterparty's lock before we reveal the secret. */
const CLAIM_SAFETY_SECONDS = 15 * 60;
/** We only hand the secret to the relayer if the solver's USDC lock has at least this long left. */
const REVEAL_MIN_SECONDS = 45 * 60;
/** The counterparty's lock must expire at least this long before ours. */
const MIN_TIMEOUT_GAP_SECONDS = 60 * 60;
/** How long the browser watches an unconfirmed solver lock for a double-spend proof before claiming. */
const DSPROOF_WINDOW_MS = 1_500;

// ------------------------------------------------------------------ trust anchors

type SolverChain = SolverInfo['chains'][number];

/** A chain the solver advertises, accepted only if its escrow and USDC match the app's pins. */
export function trustedChain(info: SolverInfo, key: string): SolverChain {
  const chain = info.chains.find((c) => c.key === key);
  if (!chain) throw new Error(`the solver does not serve ${key}`);
  const pin = TRUST.chains[chain.chainId];
  if (!pin || !pin.htlc) throw new Error(`no pinned escrow for chain ${chain.chainId}`);
  if (chain.htlc.toLowerCase() !== pin.htlc || chain.usdc.toLowerCase() !== pin.usdc) {
    throw new Error('the solver advertises an escrow or token this app does not trust');
  }
  return chain;
}

/** The token category we trade, pinned in the app; the solver must agree. */
export function trustedCategory(info: SolverInfo): string {
  if (info.pusdCategory.toLowerCase() !== TRUST.tokenCategory) throw new Error('the solver trades a token this app does not trust');
  return TRUST.tokenCategory;
}

/**
 * A quote is only a proposal. Before anything is signed it must match what the user asked for,
 * not be stale, and not charge more than the fee schedule pinned in this app.
 */
export function checkQuote(quote: Quote, want: { direction: 'in' | 'out'; chain: string; amount: number }) {
  if (quote.direction !== want.direction || quote.chain !== want.chain) throw new Error('quote is for a different swap');
  if (quote.amountIn !== want.amount) throw new Error('quote amount differs from what you entered');
  const maxFee = Math.max(TRUST.minFee, Math.ceil((want.amount * TRUST.feeBps) / 10_000));
  if (quote.amountOut < want.amount - maxFee) throw new Error('quote charges more than this app allows');
  if (quote.expiresAt < now() + 30) throw new Error('quote expired; ask again');
}

// ------------------------------------------------------------------ local secret vault

/**
 * The secret lives only in this browser until the user reveals it. We keep it in localStorage so
 * a refresh mid-swap does not strand the user, and offer it as a recovery file.
 */
export interface StoredSwap {
  id: string; secret: string; direction: 'in' | 'out'; chain: string; createdAt: number;
  /** Where THIS browser asked to be paid; checked against the solver's lock before revealing. */
  bchTarget: string; evmTarget: string;
  /** The quote this browser accepted (cents). The solver's lock must pay at least amountOut. */
  amountIn: number; amountOut: number;
  /** This browser's own lock timeout (unix seconds). The solver's lock must expire well before it. */
  ownRefundTime: number;
  /** Set once the secret left this browser; from then on we watch the chain until we are paid. */
  revealedAt?: number;
  /** The EVM lock this browser verified before revealing; the only lock we watch afterwards. */
  verifiedLockId?: string;
}
const KEY = 'chirograph:swaps';

export function storedSwaps(): StoredSwap[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as StoredSwap[]; } catch { return []; }
}
function storeSwap(s: StoredSwap) {
  try { localStorage.setItem(KEY, JSON.stringify([s, ...storedSwaps().filter((x) => x.id !== s.id)].slice(0, 50))); } catch { /* private mode */ }
}
function markRevealed(id: string, lockId: string) {
  const s = storedSwap(id);
  if (s && (!s.revealedAt || !s.verifiedLockId)) storeSwap({ ...s, revealedAt: s.revealedAt ?? now(), verifiedLockId: s.verifiedLockId ?? lockId });
}
export function storedSwap(id: string): StoredSwap | undefined {
  return storedSwaps().find((x) => x.id === id);
}
export function secretFor(id: string): Uint8Array | undefined {
  const s = storedSwaps().find((x) => x.id === id);
  return s ? hexToBin(s.secret) : undefined;
}

// ------------------------------------------------------------------ USDC -> PUSD

export interface InArgs {
  info: SolverInfo;
  quote: Quote;
  userEvm: Address;
  /** Where the PUSD should land (the connected wallet's receive address, or any token address). */
  bchTokenAddress: string;
  signTypedData: (typed: ReturnType<typeof lockAuthorization>) => Promise<Hex>;
}

/** One signature: an EIP-3009 authorization the relayer submits. Returns the swap id. */
export async function startSwapIn(a: InArgs): Promise<SwapRecord> {
  const chain = trustedChain(a.info, a.quote.chain);
  if (a.quote.htlc.toLowerCase() !== chain.htlc.toLowerCase()) throw new Error('quote escrow mismatch');
  const secret = generateSecret();
  const secretHash = to0x(hashSecret(secret));
  const id = secretHash.slice(2);
  const evmRefundTime = now() + TIMEOUTS.inEvmRefundSeconds;
  storeSwap({
    id, secret: binToHex(secret), direction: 'in', chain: chain.key, createdAt: now(),
    bchTarget: a.bchTokenAddress, evmTarget: a.userEvm, amountIn: a.quote.amountIn, amountOut: a.quote.amountOut, ownRefundTime: evmRefundTime,
  });
  const validBefore = now() + 20 * 60;
  const domain = await usdcDomain(publicClient(chain.chainId), chain.usdc, chain.chainId);
  const typed = lockAuthorization({
    chainId: chain.chainId, htlc: chain.htlc, token: chain.usdc, sender: a.userEvm,
    recipient: a.quote.solver.evmAddress, amount: BigInt(a.quote.amountIn) * 10_000n, secretHash, refundTime: BigInt(evmRefundTime),
  }, domain, BigInt(validBefore));
  const signature = await a.signTypedData(typed);
  return solver.openIn({
    chain: chain.key, amount: a.quote.amountIn, secretHash, userEvm: a.userEvm,
    userBchAddress: a.bchTokenAddress, evmRefundTime, validBefore, signature,
  });
}

/**
 * Once the solver's PUSD lock exists, claim it with no key. Before revealing anything we check the
 * lock really pays our address with the quoted amount; otherwise we keep the secret and wait for
 * the automatic refund.
 */
export async function claimSwapIn(swap: SwapRecord, onWait?: (msg: string) => void): Promise<string> {
  const category = TRUST.tokenCategory;
  const local = storedSwap(swap.id);
  const secret = secretFor(swap.id);
  if (!local || !secret || local.direction !== 'in') throw new Error('this browser does not hold this swap');
  const localHash = binToHex(hashSecret(secret));
  if (swap.id !== localHash) throw new Error('swap does not match the secret in this browser');
  // Every check below uses what THIS browser asked for, never the solver's copy of the swap.
  if (swap.bch.claimBytecode !== binToHex(addressToBytecode(local.bchTarget))) {
    throw new Error('the solver lock does not pay your address; not revealing the secret');
  }
  // Claiming reveals the secret. Only do it while the solver cannot yet refund its lock, and only if
  // the solver's lock expires well before ours (so it cannot take the PUSD back and our USDC too).
  if (swap.bch.refundTime - now() < CLAIM_SAFETY_SECONDS) {
    throw new Error('too close to the solver refund time to claim safely; your USDC will be refunded instead');
  }
  if (local.ownRefundTime - swap.bch.refundTime < MIN_TIMEOUT_GAP_SECONDS) {
    throw new Error('the solver lock does not expire early enough before yours; not revealing');
  }
  const p = await bchProvider();
  // Rebuild the lock from OUR hash and OUR address: anything else has a different lock address.
  const params: BchLockParams = {
    secretHash: hexToBin(localHash),
    claimBytecode: addressToBytecode(local.bchTarget),
    refundBytecode: hexToBin(swap.bch.refundBytecode),
    refundTime: BigInt(swap.bch.refundTime),
  };
  const contract = makeLockContract(params, p);
  const utxo = await waitForUtxo(() => findLockUtxo(contract, {
    category, amount: BigInt(local.amountOut), minSats: 1_000n,
  }));
  // The lock may still be unconfirmed. Small amounts: watch it for a double-spend proof before we
  // reveal the secret. Larger amounts, or a server that cannot answer about proofs: wait for one
  // confirmation instead. A proof means we keep the secret and wait for the refund.
  const confirmations = async () => {
    const tx = await p.performRequest('blockchain.transaction.get', utxo.txid, true).catch(() => ({})) as { confirmations?: number };
    return tx.confirmations ?? 0;
  };
  if ((await confirmations()) < 1) {
    await new Promise((r) => setTimeout(r, DSPROOF_WINDOW_MS));
    let proof: 'proof' | 'none' | 'unknown';
    try {
      proof = (await p.performRequest('blockchain.transaction.dsproof.get', utxo.txid)) ? 'proof' : 'none';
    } catch {
      proof = 'unknown';
    }
    if (proof === 'proof') throw new Error('a double-spend was attempted against the solver lock; not revealing');
    if (proof === 'unknown' || local.amountOut > TRUST.userInstantMax) {
      onWait?.('waiting for one Bitcoin Cash confirmation of the solver lock');
      while ((await confirmations()) < 1) {
        if (swap.bch.refundTime - now() < CLAIM_SAFETY_SECONDS) throw new Error('the solver lock did not confirm in time; your USDC will be refunded');
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }
  const hex = buildKeylessSpend({ provider: p, contract, utxo, params, path: 'claim', secret }).build();
  const txid = await p.sendRawTransaction(hex);
  await solver.claimed(swap.id, txid).catch(() => undefined);
  return txid;
}

// ------------------------------------------------------------------ PUSD -> USDC

export interface OutArgs {
  info: SolverInfo;
  quote: Quote;
  manager: DappConnectionManager;
  wallet: WalletSnapshot;
  userEvm: Address;
  signal?: AbortSignal;
}

/** One signature: the wallet signs a BCH lock that also commits to the EVM payout address. */
export async function startSwapOut(a: OutArgs): Promise<SwapRecord> {
  const chain = trustedChain(a.info, a.quote.chain);
  const category = trustedCategory(a.info);
  const p = await bchProvider();
  const secret = generateSecret();
  const secretHash = hashSecret(secret);
  const id = binToHex(secretHash);
  const bchRefundTime = now() + TIMEOUTS.outBchRefundSeconds;
  storeSwap({
    id, secret: binToHex(secret), direction: 'out', chain: chain.key, createdAt: now(),
    bchTarget: a.wallet.receive.tokenAddress, evmTarget: a.userEvm, amountIn: a.quote.amountIn, amountOut: a.quote.amountOut, ownRefundTime: bchRefundTime,
  });
  const params: BchLockParams = {
    secretHash,
    claimBytecode: addressToBytecode(a.quote.solver.bchTokenAddress),
    refundBytecode: a.wallet.receive.lockingBytecode,
    refundTime: BigInt(bchRefundTime),
  };
  const contract = makeLockContract(params, p);
  const change = a.wallet.addresses.find((x) => x.chain === 'change') ?? a.wallet.receive;
  const built = buildWalletLockTx({
    provider: p, contract, utxos: a.wallet.utxos,
    token: { category, amount: BigInt(a.quote.amountIn) },
    changeAddress: change.address, tokenChangeAddress: a.wallet.receive.tokenAddress,
    memo: { chainId: chain.chainId, evmAddress: a.userEvm },
    userPrompt: `Lock ${(a.quote.amountIn / 100).toFixed(2)} PUSD for ${(a.quote.amountOut / 100).toFixed(2)} USDC on ${chain.key === 'arbitrum' ? 'Arbitrum' : 'Base'}`,
  });
  const lockTxid = await signAndBroadcast(a.manager, built, 'Chirograph swap', a.signal);
  return solver.openOut({
    chain: chain.key, amount: a.quote.amountIn, secretHash: id, userEvm: a.userEvm,
    userBchAddress: a.wallet.receive.tokenAddress, bchRefundTime, lockTxid,
  });
}

/**
 * Reveal only after reading the solver's USDC lock on-chain ourselves: it must pay our address the
 * quoted amount under our hash and still be open. The relayer then claims it for us (gasless).
 */
export async function revealSwapOut(swap: SwapRecord, info: SolverInfo): Promise<SwapRecord> {
  const secret = secretFor(swap.id);
  if (!secret) throw new Error('this browser does not hold the secret for this swap');
  await checkSolverEvmLock(swap, info, secret);
  markRevealed(swap.id, swap.evm.lockId);
  return solver.reveal(swap.id, binToHex(secret));
}

/**
 * The on-chain state of the USDC lock this browser verified before revealing, read directly from the
 * pinned escrow. Nothing the solver reports afterwards can change which lock we watch.
 */
export async function evmLockState(swapId: string, info: SolverInfo): Promise<LockState> {
  const local = storedSwap(swapId);
  if (!local?.verifiedLockId) throw new Error('no verified lock for this swap');
  const chain = trustedChain(info, local.chain);
  const [, , , , , state] = await publicClient(chain.chainId).readContract({
    address: chain.htlc, abi: htlcAbi, functionName: 'locks', args: [local.verifiedLockId as Hex],
  });
  return state as LockState;
}

/**
 * Everything we check on-chain before the secret leaves this browser, all against the values this
 * browser chose: the solver's USDC lock pays OUR address at least the quoted amount, under the hash
 * of OUR secret, is still open, and expires well before our own PUSD lock.
 */
export async function checkSolverEvmLock(
  swap: SwapRecord, info: SolverInfo, secret: Uint8Array, opts: { afterReveal?: boolean } = {},
): Promise<SolverChain> {
  const local = storedSwap(swap.id);
  if (!local || local.direction !== 'out') throw new Error('this browser does not hold this swap');
  const chain = trustedChain(info, local.chain);
  const [, recipient, amount, secretHash, refundTime, state] = await publicClient(chain.chainId).readContract({
    address: chain.htlc, abi: htlcAbi, functionName: 'locks', args: [swap.evm.lockId as Hex],
  });
  if (state !== LockState.Open) throw new Error('the solver lock is not open');
  if (recipient.toLowerCase() !== local.evmTarget.toLowerCase()) throw new Error('the solver lock does not pay your address; not revealing');
  if (amount < BigInt(local.amountOut) * 10_000n) throw new Error('the solver locked less than you were quoted; not revealing');
  if (secretHash.toLowerCase() !== to0x(hashSecret(secret)).toLowerCase()) throw new Error('the solver lock uses a different hash; not revealing');
  if (!opts.afterReveal && Number(refundTime) - now() < REVEAL_MIN_SECONDS) throw new Error('too close to the solver refund time; not revealing');
  if (!opts.afterReveal && local.ownRefundTime - Number(refundTime) < MIN_TIMEOUT_GAP_SECONDS) throw new Error('solver timeout is not well before ours; not revealing');
  return chain;
}

/**
 * Fallback if the relayer does not claim in time: the user claims their USDC directly with their
 * own wallet (they pay the gas). Same checks as a relayed reveal.
 */
export async function claimEvmDirect(
  swap: SwapRecord, info: SolverInfo,
  write: (req: { address: Address; abi: typeof htlcAbi; functionName: 'claim'; args: [Hex, Hex]; chainId: number }) => Promise<Hex>,
): Promise<Hex> {
  const secret = secretFor(swap.id);
  if (!secret) throw new Error('this browser does not hold the secret for this swap');
  // Once the secret is out, claiming is always right while the lock is open: no time floor here.
  const local = storedSwap(swap.id);
  const lockId = (local?.verifiedLockId ?? swap.evm.lockId) as Hex;
  const chain = await checkSolverEvmLock({ ...swap, evm: { ...swap.evm, lockId } }, info, secret, { afterReveal: true });
  return write({ address: chain.htlc, abi: htlcAbi, functionName: 'claim', args: [lockId, to0x(secret)], chainId: chain.chainId });
}

// ------------------------------------------------------------------ refunds anyone can run

/** Keyless BCH refund of a lock whose timeout has passed (the solver's watchtower also does this). */
export async function refundBchLock(swap: SwapRecord): Promise<string> {
  const p = await bchProvider();
  const params = paramsOf(swap);
  const contract = makeLockContract(params, p);
  const utxo = await findLockUtxo(contract, { txid: swap.bch.lockTxid });
  if (!utxo) throw new Error('nothing left to refund at this lock');
  const hex = buildKeylessSpend({ provider: p, contract, utxo, params, path: 'refund' }).build();
  return p.sendRawTransaction(hex);
}

export function paramsOf(swap: SwapRecord): BchLockParams {
  return {
    secretHash: hexToBin(swap.secretHash),
    claimBytecode: hexToBin(swap.bch.claimBytecode),
    refundBytecode: hexToBin(swap.bch.refundBytecode),
    refundTime: BigInt(swap.bch.refundTime),
  };
}

export { scanWallet };
