import { ElectrumNetworkProvider, SignatureTemplate, type SpendableUtxo } from 'cashscript';
import { binToHex, decodeAuthenticationInstructions, decodeTransaction, hash160, hexToBin, sha256, swapEndianness } from '@bitauth/libauth';
import {
  addressToBytecode, buildKeylessSpend, buildSignedLockTx, bytecodeToAddress, extractSecret, makeLockContract,
  pickLockUtxo, type BchLockParams, type LockContract, type LockExpectation,
} from '@chirograph/sdk';
import { Mutex } from './mutex.js';
import type { SolverConfig } from './config.js';

export interface LockSighting {
  utxo: SpendableUtxo;
  confirmations: number;
}

/** Everything the solver does on Bitcoin Cash: its wallet, locks, keyless spends and chain reads. */
export class BchSide {
  readonly provider: ElectrumNetworkProvider;
  readonly signer: SignatureTemplate;
  readonly address: string;
  readonly tokenAddress: string;
  readonly bytecode: Uint8Array;
  private walletLock = new Mutex();

  constructor(private cfg: SolverConfig) {
    // One long-lived connection: opening a websocket per request adds seconds of latency and
    // occasional stalls, which would eat into the instant tier.
    this.provider = new ElectrumNetworkProvider(
      cfg.bchNetwork,
      cfg.electrumHost
        ? { hostname: cfg.electrumHost, manualConnectionManagement: true }
        : { manualConnectionManagement: true },
    );
    this.signer = new SignatureTemplate(cfg.bchWif);
    const pkh = this.signer.publicKey;
    this.bytecode = hexToBin(`76a914${binToHex(hash160(pkh))}88ac`);
    this.address = bytecodeToAddress(this.bytecode, cfg.bchNetwork, false);
    this.tokenAddress = bytecodeToAddress(this.bytecode, cfg.bchNetwork, true);
  }

  contract(params: BchLockParams): LockContract {
    return makeLockContract(params, this.provider);
  }

  async inventory() {
    const utxos = await this.provider.getUtxos(this.address);
    let tokens = 0n;
    let sats = 0n;
    for (const u of utxos) {
      sats += u.satoshis;
      if (u.token?.category === this.cfg.tokenCategory && !u.token.nft) tokens += u.token.amount;
    }
    return { tokens, sats, utxos: utxos.length };
  }

  /**
   * Build and sign (but do not broadcast) a transaction locking `amount` tokens from the solver
   * wallet. The caller persists the hex before broadcasting, so a retry re-sends the exact same
   * transaction instead of building a second lock.
   */
  async buildTokenLock(params: BchLockParams, amount: bigint): Promise<{ hex: string; txid: string; lockAddress: string }> {
    return this.walletLock.run(async () => {
      const contract = this.contract(params);
      const utxos = await this.provider.getUtxos(this.address);
      const builder = buildSignedLockTx({
        provider: this.provider,
        contract,
        utxos,
        unlocker: this.signer.unlockP2PKH(),
        token: { category: this.cfg.tokenCategory, amount },
        changeAddress: this.tokenAddress,
      });
      const hex = builder.build();
      return { hex, txid: txidOf(hex), lockAddress: contract.tokenAddress };
    });
  }

  /** Keyless claim or refund of a lock; returns the spending txid. */
  async spend(params: BchLockParams, expect: LockExpectation, path: 'claim' | 'refund', secret?: Uint8Array): Promise<string> {
    const contract = this.contract(params);
    const utxo = pickLockUtxo(await contract.getUtxos(), expect);
    if (!utxo) throw new Error('lock not found (already spent or never funded)');
    const builder = buildKeylessSpend({ provider: this.provider, contract, utxo, params, path, secret });
    return this.broadcast(builder.build());
  }

  /** Current lock UTXO and how deep it is, or undefined if nothing sits at the lock address. */
  async sight(params: BchLockParams, expect: LockExpectation): Promise<LockSighting | undefined> {
    const contract = this.contract(params);
    const utxo = pickLockUtxo(await contract.getUtxos(), expect);
    if (!utxo) return undefined;
    return { utxo, confirmations: await this.confirmations(utxo.txid) };
  }

  /** True if the network knows this transaction (mempool or chain). */
  async txKnown(txid: string): Promise<boolean> {
    try {
      await this.provider.getRawTransaction(txid);
      return true;
    } catch {
      return false;
    }
  }

  async confirmations(txid: string): Promise<number> {
    const tx = (await this.provider.performRequest('blockchain.transaction.get', txid, true)) as { confirmations?: number };
    return tx.confirmations ?? 0;
  }

  /**
   * Double-spend-proof status of an unconfirmed transaction: 'proof' if a node reported one,
   * 'none' if the server answered without one, 'unknown' if it could not answer. Callers that
   * take 0-conf risk must treat 'unknown' as unsafe.
   */
  async doubleSpendProof(txid: string): Promise<'proof' | 'none' | 'unknown'> {
    try {
      const proof = await this.provider.performRequest('blockchain.transaction.dsproof.get', txid);
      return proof === null || proof === undefined ? 'none' : 'proof';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Double-spend proofs only cover P2PKH inputs. A transaction funded from anything else could be
   * double-spent without a proof ever appearing, so it does not qualify for 0-conf.
   */
  async inputsAreP2pkh(txid: string): Promise<boolean> {
    const tx = decodeTransaction(hexToBin(await this.provider.getRawTransaction(txid)));
    if (typeof tx === 'string') return false;
    return tx.inputs.every((input) => {
      const pushes = decodeAuthenticationInstructions(input.unlockingBytecode);
      if (pushes.length !== 2) return false;
      const [sig, pub] = pushes.map((i) => (i as { data?: Uint8Array }).data);
      return !!sig && !!pub && (sig.length === 65 || (sig.length >= 70 && sig.length <= 73)) && pub.length === 33;
    });
  }

  /** Find the transaction that spent a lock and pull the secret out of it, if it was a claim. */
  async findClaimSecret(params: BchLockParams, lockTxid?: string): Promise<{ txid: string; secret: Uint8Array } | undefined> {
    const contract = this.contract(params);
    const scripthash = swapEndianness(binToHex(sha256.hash(hexToBin(contract.lockingBytecode))));
    const history = (await this.provider.performRequest('blockchain.scripthash.get_history', scripthash)) as Array<{ tx_hash: string }>;
    for (const { tx_hash } of history) {
      if (tx_hash === lockTxid) continue;
      const hex = (await this.provider.getRawTransaction(tx_hash)) as string;
      const secret = extractSecret(hex, params.secretHash);
      if (secret) return { txid: tx_hash, secret };
    }
    return undefined;
  }

  /** Was the lock spent at all (claim or refund)? */
  async lockHistory(params: BchLockParams): Promise<string[]> {
    const contract = this.contract(params);
    const scripthash = swapEndianness(binToHex(sha256.hash(hexToBin(contract.lockingBytecode))));
    const history = (await this.provider.performRequest('blockchain.scripthash.get_history', scripthash)) as Array<{ tx_hash: string }>;
    return history.map((h) => h.tx_hash);
  }

  /** Median time past of the tip: what the network compares time-based nLockTime against. */
  async medianTimePast(): Promise<number> {
    const tip = (await this.provider.performRequest('blockchain.headers.get_tip')) as { height: number };
    const res = (await this.provider.performRequest('blockchain.block.headers', tip.height - 10, 11)) as { hex: string };
    const raw = hexToBin(res.hex);
    const times: number[] = [];
    for (let off = 0; off + 80 <= raw.length; off += 80) {
      times.push(new DataView(raw.buffer, raw.byteOffset + off + 68, 4).getUint32(0, true));
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)]!;
  }

  async broadcast(hex: string): Promise<string> {
    const decoded = decodeTransaction(hexToBin(hex));
    if (typeof decoded === 'string') throw new Error(decoded);
    try {
      return await this.provider.sendRawTransaction(hex);
    } catch (err) {
      const msg = String((err as Error).message ?? err);
      // Re-broadcasting a transaction the node already has is success, not failure.
      if (/already|known|txn-mempool-conflict-same/i.test(msg)) return txidOf(hex);
      throw err;
    }
  }

  addressBytecode(address: string) {
    return addressToBytecode(address);
  }
}


export function txidOf(hex: string): string {
  return swapEndianness(binToHex(sha256.hash(sha256.hash(hexToBin(hex)))));
}
