import {
  Contract,
  TransactionBuilder,
  placeholderP2PKHUnlocker,
  type NetworkProvider,
  type SpendableUtxo,
  type Unlocker,
  type Utxo,
  type WcTransactionObject,
} from 'cashscript';
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeAuthenticationInstructions,
  decodeTransaction,
  encodeTransactionBch,
  hexToBin,
  lockingBytecodeToCashAddress,
  sha256,
} from '@bitauth/libauth';
import artifact from '@chirograph/bch-contracts/artifacts/ChirographLock.json' with { type: 'json' };
import { KEYLESS_SPEND_FEE, LOCK_SATS, MAX_EXECUTOR_FEE, type BchNetwork } from './constants.js';

export const lockArtifact = artifact;
export type LockContract = Contract<typeof artifact>;

/** Everything that defines one BCH lock. Same values -> same address, on every machine. */
export interface BchLockParams {
  secretHash: Uint8Array;
  claimBytecode: Uint8Array;
  refundBytecode: Uint8Array;
  /** Unix seconds (> 500_000_000 so the VM reads it as time, compared against MTP). */
  refundTime: bigint;
  maxFee?: bigint;
}

export function makeLockContract(params: BchLockParams, provider: NetworkProvider): LockContract {
  if (params.secretHash.length !== 32) throw new Error('secretHash must be 32 bytes');
  if (params.refundTime < 500_000_000n) throw new Error('refundTime must be a unix timestamp, not a block height');
  return new Contract(
    artifact,
    [params.secretHash, params.claimBytecode, params.refundBytecode, params.refundTime, params.maxFee ?? MAX_EXECUTOR_FEE],
    { provider, contractType: 'p2sh32' },
  );
}

export function addressToBytecode(address: string): Uint8Array {
  const result = cashAddressToLockingBytecode(address);
  if (typeof result === 'string') throw new Error(`invalid cashaddr ${address}: ${result}`);
  return result.bytecode;
}

export function bytecodeToAddress(bytecode: Uint8Array, network: BchNetwork, tokens = false): string {
  const prefix = network === 'mainnet' ? 'bitcoincash' : 'bchtest';
  const result = lockingBytecodeToCashAddress({ bytecode, prefix, tokenSupport: tokens });
  if (typeof result === 'string') throw new Error(`cannot encode address: ${result}`);
  return result.address;
}

/**
 * A keyless claim or refund: one lock input, one payout at the same index. No key is needed,
 * so the user's browser, the solver or a watchtower can all build and broadcast it.
 */
export function buildKeylessSpend(opts: {
  provider: NetworkProvider;
  contract: LockContract;
  utxo: SpendableUtxo;
  params: BchLockParams;
  path: 'claim' | 'refund';
  secret?: Uint8Array;
  fee?: bigint;
}): TransactionBuilder {
  const fee = opts.fee ?? KEYLESS_SPEND_FEE;
  const maxFee = opts.params.maxFee ?? MAX_EXECUTOR_FEE;
  if (fee > maxFee) throw new Error('fee exceeds the covenant cap');
  if (opts.utxo.satoshis <= fee + 546n) throw new Error('lock UTXO too small to pay the spend fee');
  const destination = opts.path === 'claim' ? opts.params.claimBytecode : opts.params.refundBytecode;
  const unlocker = opts.path === 'claim'
    ? opts.contract.unlock['claim']!(requireSecret(opts.secret))
    : opts.contract.unlock['refund']!();
  const builder = new TransactionBuilder({ provider: opts.provider, maximumFeeSatoshis: maxFee })
    .addInput(opts.utxo, unlocker)
    .addOutput({ to: destination, amount: opts.utxo.satoshis - fee, token: opts.utxo.token });
  if (opts.path === 'refund') builder.setLocktime(Number(opts.params.refundTime));
  return builder;
}

function requireSecret(secret?: Uint8Array): Uint8Array {
  if (!secret || secret.length !== 32) throw new Error('claim needs the 32-byte secret');
  return secret;
}

/**
 * Pull the secret out of any transaction that spent a lock through `claim`. We look for a 32-byte
 * push whose sha256 matches, so it works regardless of input order or batching.
 */
export function extractSecret(txHex: string, secretHash: Uint8Array): Uint8Array | undefined {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') throw new Error(`cannot decode transaction: ${tx}`);
  const wanted = binToHex(secretHash);
  for (const input of tx.inputs) {
    for (const instruction of decodeAuthenticationInstructions(input.unlockingBytecode)) {
      const data = (instruction as { data?: Uint8Array }).data;
      if (data && data.length === 32 && binToHex(sha256.hash(data)) === wanted) return data;
    }
  }
  return undefined;
}

export interface WalletUtxo extends SpendableUtxo {
  /** Cash address that owns this UTXO (needed for placeholder signing). */
  address: string;
  /** WizardConnect derivation of the owning key. */
  path: { chain: 'receive' | 'change' | 'defi'; index: number };
}

export interface LockTxResult {
  wc: WcTransactionObject;
  /** Hex of the unsigned transaction (Paytaca requires hex). */
  txHex: string;
  /** [inputIndex, chain, addressIndex] for every wallet-signed input. */
  inputPaths: Array<[number, 'receive' | 'change' | 'defi', number]>;
  lockOutputIndex: number;
}

/**
 * Build the user's lock transaction for WizardConnect signing: wallet UTXOs in, the lock
 * output first, then token change and BCH change back to the wallet. The wallet fills in the
 * signatures; we broadcast ourselves (Selene never broadcasts).
 */
export function buildWalletLockTx(opts: {
  provider: NetworkProvider;
  contract: LockContract;
  utxos: WalletUtxo[];
  token?: { category: string; amount: bigint };
  bchAmount?: bigint;
  changeAddress: string;
  tokenChangeAddress: string;
  feeRate?: number;
  userPrompt?: string;
  /** PUSD -> USDC: commit the EVM payout address inside the same signed transaction. */
  memo?: LockMemo;
}): LockTxResult {
  const feeRate = opts.feeRate ?? 1.0;
  const lockValue = opts.bchAmount ?? LOCK_SATS;
  const selected: WalletUtxo[] = [];
  let tokenIn = 0n;
  if (opts.token) {
    const tokenUtxos = opts.utxos
      .filter((u) => u.token?.category === opts.token!.category && !u.token.nft)
      .sort((a, b) => Number((b.token!.amount) - (a.token!.amount)));
    for (const u of tokenUtxos) {
      if (tokenIn >= opts.token.amount) break;
      selected.push(u);
      tokenIn += u.token!.amount;
    }
    if (tokenIn < opts.token.amount) throw new Error('not enough tokens in the wallet');
  }
  const bchOnly = opts.utxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis));
  const estimate = () => {
    const ins = selected.reduce((s, u) => s + u.satoshis, 0n);
    // lock + up to two change outputs + ~150 bytes per signed input, all at feeRate
    const size = 200n + BigInt(selected.length) * 150n;
    return { ins, need: lockValue + (opts.token && tokenIn > opts.token.amount ? 1_000n : 0n) + BigInt(Math.ceil(Number(size) * feeRate)) + 546n };
  };
  for (const u of bchOnly) {
    const { ins, need } = estimate();
    if (ins >= need) break;
    selected.push(u);
  }
  if (estimate().ins < estimate().need) throw new Error('not enough BCH in the wallet for the lock and fee');

  const builder = new TransactionBuilder({ provider: opts.provider });
  for (const u of selected) builder.addInput(u, placeholderP2PKHUnlocker(u.address) as Unlocker);
  builder.addOutput({
    to: hexToBin(opts.contract.lockingBytecode),
    amount: lockValue,
    token: opts.token ? { category: opts.token.category, amount: opts.token.amount } : undefined,
  });
  if (opts.token && tokenIn > opts.token.amount) {
    builder.addOutput({ to: addressToBytecode(opts.tokenChangeAddress), amount: 1_000n, token: { category: opts.token.category, amount: tokenIn - opts.token.amount } });
  }
  if (opts.memo) builder.addOpReturnOutput(lockMemoChunks(opts.memo));
  builder.addBchChangeOutputIfNeeded({ to: addressToBytecode(opts.changeAddress), feeRate });

  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt: opts.userPrompt ?? 'Lock funds for a Chirograph swap' });
  const txHex = binToHex(encodeTx(wc));
  const inputPaths = selected.map((u, i) => [i, u.path.chain, u.path.index] as [number, 'receive' | 'change' | 'defi', number]);
  return { wc, txHex, inputPaths, lockOutputIndex: 0 };
}

/**
 * Lock built and signed server-side (the solver's own wallet). `unlocker` signs every input.
 */
export function buildSignedLockTx(opts: {
  provider: NetworkProvider;
  contract: LockContract;
  utxos: SpendableUtxo[];
  unlocker: Unlocker;
  token?: { category: string; amount: bigint };
  bchAmount?: bigint;
  changeAddress: string;
  feeRate?: number;
}): TransactionBuilder {
  const feeRate = opts.feeRate ?? 1.0;
  const lockValue = opts.bchAmount ?? LOCK_SATS;
  const inputs: SpendableUtxo[] = [];
  let tokenIn = 0n;
  if (opts.token) {
    for (const u of opts.utxos.filter((u) => u.token?.category === opts.token!.category && !u.token.nft)) {
      if (tokenIn >= opts.token.amount) break;
      inputs.push(u);
      tokenIn += u.token!.amount;
    }
    if (tokenIn < opts.token.amount) throw new Error('solver is out of tokens');
  }
  let bchIn = inputs.reduce((s, u) => s + u.satoshis, 0n);
  const need = lockValue + 1_000n + 3_000n;
  for (const u of opts.utxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))) {
    if (bchIn >= need) break;
    inputs.push(u);
    bchIn += u.satoshis;
  }
  if (bchIn < need) throw new Error('solver is out of BCH for fees');
  const builder = new TransactionBuilder({ provider: opts.provider });
  for (const u of inputs) builder.addInput(u, opts.unlocker);
  builder.addOutput({ to: hexToBin(opts.contract.lockingBytecode), amount: lockValue, token: opts.token });
  if (opts.token && tokenIn > opts.token.amount) {
    builder.addOutput({ to: addressToBytecode(opts.changeAddress), amount: 1_000n, token: { category: opts.token.category, amount: tokenIn - opts.token.amount } });
  }
  builder.addBchChangeOutputIfNeeded({ to: addressToBytecode(opts.changeAddress), feeRate });
  return builder;
}

function encodeTx(wc: WcTransactionObject): Uint8Array {
  return encodeTransactionBch(wc.transaction);
}

export interface LockExpectation {
  /** Token category the lock must carry (omit for plain-BCH locks). */
  category?: string;
  /** Minimum token amount (the quoted amount). */
  amount?: bigint;
  minSats?: bigint;
  /** If known, the exact funding outpoint; anything else at the address is ignored. */
  txid?: string;
  vout?: number;
}

/**
 * Pick the real lock UTXO among everything sitting at a lock address. Anyone can send dust or
 * junk tokens to a lock address, so we never take "the first UTXO": only one that matches what the
 * swap expects counts, and an exact funding outpoint wins when we know it.
 */
export function pickLockUtxo<U extends Utxo>(utxos: U[], expect: LockExpectation): U | undefined {
  const matching = utxos.filter((u) => checkLockUtxo(u, expect) === undefined);
  if (expect.txid) {
    return matching.find((u) => u.txid === expect.txid && (expect.vout === undefined || u.vout === expect.vout));
  }
  return matching.sort((a, b) => Number((b.token?.amount ?? 0n) - (a.token?.amount ?? 0n)))[0];
}

/** Find the lock UTXO (if any) at a lock contract's address that matches the expectation. */
export async function findLockUtxo(contract: LockContract, expect: LockExpectation): Promise<SpendableUtxo | undefined> {
  return pickLockUtxo(await contract.getUtxos(), expect);
}

/** Basic sanity check a counterparty lock before trusting it: value, token and amount. */
export function checkLockUtxo(utxo: Utxo, expect: { category?: string; amount?: bigint; minSats?: bigint }): string | undefined {
  if (expect.minSats !== undefined && utxo.satoshis < expect.minSats) return 'lock carries too few satoshis';
  if (expect.category) {
    if (!utxo.token || utxo.token.category !== expect.category) return 'lock holds the wrong token';
    if (utxo.token.nft) return 'lock unexpectedly carries an NFT';
    if (expect.amount !== undefined && utxo.token.amount < expect.amount) return 'lock holds fewer tokens than quoted';
  }
  return undefined;
}

/**
 * The payout binding for PUSD -> USDC swaps: an OP_RETURN in the user's own lock transaction
 * naming the EVM chain and address that should receive the USDC. Because it sits in the
 * transaction the user's wallet signs, nobody else can point the solver at a different payout.
 */
export interface LockMemo { chainId: number; evmAddress: string }
export const LOCK_MEMO_TAG = 'CHRG';

export function lockMemoChunks(memo: LockMemo): string[] {
  const addr = memo.evmAddress.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(addr)) throw new Error('memo needs a 20-byte EVM address');
  return [LOCK_MEMO_TAG, `0x${memo.chainId.toString(16).padStart(8, '0')}`, `0x${addr}`];
}

export function parseLockMemo(txHex: string): LockMemo | undefined {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') throw new Error(`cannot decode transaction: ${tx}`);
  for (const out of tx.outputs) {
    if (out.lockingBytecode[0] !== 0x6a) continue; // OP_RETURN
    const parts = decodeAuthenticationInstructions(out.lockingBytecode.slice(1))
      .map((i) => (i as { data?: Uint8Array }).data);
    const [tag, chain, addr] = parts;
    if (!tag || !chain || !addr || new TextDecoder().decode(tag) !== LOCK_MEMO_TAG) continue;
    if (chain.length !== 4 || addr.length !== 20) continue;
    return { chainId: new DataView(chain.buffer, chain.byteOffset, 4).getUint32(0), evmAddress: `0x${binToHex(addr)}` };
  }
  return undefined;
}
