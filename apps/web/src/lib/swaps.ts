import { binToHex, hexToBin } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import type { Address, Hex } from 'viem';
import {
  SolverClient, TIMEOUTS, LockState, addressToBytecode, buildKeylessSpend, buildWalletLockTx, findLockUtxo,
  generateSecret, hashSecret, htlcAbi, lockAuthorization, makeLockContract, to0x, usdcDomain,
  type BchLockParams, type Quote, type SolverInfo, type SwapRecord,
} from '@chirograph/sdk';
import { CONFIG } from './config';
import { bchProvider, scanWallet, signAndBroadcast, waitForUtxo, type WalletSnapshot } from './bchWallet';
import { publicClient } from './evm';

export const solver = new SolverClient(CONFIG.solverUrl);
const now = () => Math.floor(Date.now() / 1000);
/** Minimum time left on the counterparty's lock before we reveal the secret. */
const CLAIM_SAFETY_SECONDS = 15 * 60;

// ------------------------------------------------------------------ local secret vault

/**
 * The secret lives only in this browser until the user reveals it. We keep it in localStorage so
 * a refresh mid-swap does not strand the user, and offer it as a recovery file.
 */
export interface StoredSwap {
  id: string; secret: string; direction: 'in' | 'out'; chain: string; createdAt: number;
  /** Where THIS browser asked to be paid; checked against the solver's lock before revealing. */
  bchTarget?: string; evmTarget?: string;
}
const KEY = 'chirograph:swaps';

export function storedSwaps(): StoredSwap[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as StoredSwap[]; } catch { return []; }
}
function storeSwap(s: StoredSwap) {
  try { localStorage.setItem(KEY, JSON.stringify([s, ...storedSwaps().filter((x) => x.id !== s.id)].slice(0, 50))); } catch { /* private mode */ }
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
  const chain = a.info.chains.find((c) => c.key === a.quote.chain)!;
  const secret = generateSecret();
  const secretHash = to0x(hashSecret(secret));
  const id = secretHash.slice(2);
  storeSwap({ id, secret: binToHex(secret), direction: 'in', chain: chain.key, createdAt: now(), bchTarget: a.bchTokenAddress, evmTarget: a.userEvm });
  const evmRefundTime = now() + TIMEOUTS.inEvmRefundSeconds;
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
export async function claimSwapIn(swap: SwapRecord, expectedTokenAddress: string, category: string): Promise<string> {
  const secret = secretFor(swap.id);
  if (!secret) throw new Error('this browser does not hold the secret for this swap');
  const localHash = binToHex(hashSecret(secret));
  if (swap.id !== localHash || swap.secretHash !== localHash) throw new Error('swap does not match the secret in this browser');
  if (swap.bch.claimBytecode !== binToHex(addressToBytecode(expectedTokenAddress))) {
    throw new Error('the solver lock does not pay your address; not revealing the secret');
  }
  // Claiming reveals the secret. Only do it while the solver cannot yet refund its lock,
  // otherwise it could take back the PUSD and still collect our USDC with the revealed secret.
  if (swap.bch.refundTime - now() < CLAIM_SAFETY_SECONDS) {
    throw new Error('too close to the solver refund time to claim safely; your USDC will be refunded instead');
  }
  const p = await bchProvider();
  // Rebuild the lock from OUR hash: a lock built on any other hash has a different address.
  const params = { ...paramsOf(swap), secretHash: hexToBin(localHash) };
  const contract = makeLockContract(params, p);
  const utxo = await waitForUtxo(() => findLockUtxo(contract, {
    category, amount: BigInt(swap.amountOut), minSats: 1_000n, txid: swap.bch.lockTxid,
  }));
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
  const chain = a.info.chains.find((c) => c.key === a.quote.chain)!;
  const p = await bchProvider();
  const secret = generateSecret();
  const secretHash = hashSecret(secret);
  const id = binToHex(secretHash);
  storeSwap({ id, secret: binToHex(secret), direction: 'out', chain: chain.key, createdAt: now(), bchTarget: a.wallet.receive.tokenAddress, evmTarget: a.userEvm });
  const bchRefundTime = now() + TIMEOUTS.outBchRefundSeconds;
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
    token: { category: a.info.pusdCategory, amount: BigInt(a.quote.amountIn) },
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
export async function revealSwapOut(swap: SwapRecord, info: SolverInfo, userEvm: Address): Promise<SwapRecord> {
  const secret = secretFor(swap.id);
  if (!secret) throw new Error('this browser does not hold the secret for this swap');
  await checkSolverEvmLock(swap, info, userEvm, secret);
  return solver.reveal(swap.id, binToHex(secret));
}

/**
 * Everything we check on-chain before the secret leaves this browser: the solver's USDC lock pays
 * our address the quoted amount, under the hash of OUR secret, is still open, and cannot be
 * refunded by the solver before our claim lands.
 */
export async function checkSolverEvmLock(swap: SwapRecord, info: SolverInfo, userEvm: Address, secret: Uint8Array) {
  const chain = info.chains.find((c) => c.key === swap.chain)!;
  const [, recipient, amount, secretHash, refundTime, state] = await publicClient(chain.chainId).readContract({
    address: chain.htlc, abi: htlcAbi, functionName: 'locks', args: [swap.evm.lockId as Hex],
  });
  if (state !== LockState.Open) throw new Error('the solver lock is not open');
  if (recipient.toLowerCase() !== userEvm.toLowerCase()) throw new Error('the solver lock does not pay your address; not revealing');
  if (amount !== BigInt(swap.amountOut) * 10_000n) throw new Error('the solver lock amount does not match the quote; not revealing');
  if (secretHash.toLowerCase() !== to0x(hashSecret(secret)).toLowerCase()) throw new Error('the solver lock uses a different hash; not revealing');
  if (Number(refundTime) - now() < CLAIM_SAFETY_SECONDS) throw new Error('too close to the solver refund time; not revealing');
  // The solver must still be unable to refund our PUSD lock when it learns the secret.
  if (Number(refundTime) >= swap.bch.refundTime) throw new Error('solver timeout is not shorter than ours; not revealing');
}

/**
 * Fallback if the relayer does not claim in time: the user claims their USDC directly with their
 * own wallet (they pay the gas). Same checks as a relayed reveal.
 */
export async function claimEvmDirect(
  swap: SwapRecord, info: SolverInfo, userEvm: Address,
  write: (req: { address: Address; abi: typeof htlcAbi; functionName: 'claim'; args: [Hex, Hex]; chainId: number }) => Promise<Hex>,
): Promise<Hex> {
  const secret = secretFor(swap.id);
  if (!secret) throw new Error('this browser does not hold the secret for this swap');
  await checkSolverEvmLock(swap, info, userEvm, secret);
  const chain = info.chains.find((c) => c.key === swap.chain)!;
  return write({ address: chain.htlc, abi: htlcAbi, functionName: 'claim', args: [swap.evm.lockId as Hex, to0x(secret)], chainId: chain.chainId });
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
