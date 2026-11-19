import { EventEmitter } from 'node:events';
import { binToHex, hexToBin } from '@bitauth/libauth';
import type { Address, Hex } from 'viem';
import {
  LOCK_SATS, TIMEOUTS, USDC_UNITS_PER_PUSD_UNIT, addressToBytecode, bytecodeToAddress, computeLockId, hashSecret,
  quoteFee, LockState, parseLockMemo, htlcAbi,
  type BchLockParams, type EvmChainKey, type OpenInSwap, type OpenOutSwap, type Quote, type QuoteRequest,
  type SolverInfo, type SwapRecord, type SwapStatus, type TimelineEvent,
} from '@chirograph/sdk';
import type { SolverConfig } from './config.js';
import type { SwapStore } from './db.js';
import type { BchSide } from './bch.js';
import type { EvmSide } from './evm.js';
import { now } from './mutex.js';
import { UserError, publicMessage } from './errors.js';

const TERMINAL: SwapStatus[] = ['completed', 'refunded', 'failed'];
/** Accept refund times within this slack of the nominal timeout (clock skew, slow signing). */
const TIMEOUT_SLACK = 30 * 60;
/** Median time past trails wall-clock time on BCH; budget for it on every BCH refund. */
const MTP_LAG = 60 * 60;
/** Minimum time the counterparty keeps to reuse a revealed secret before the other side can refund. */
const MIN_CLAIM_MARGIN = 90 * 60;

export class Engine {
  readonly events = new EventEmitter();
  private busy = new Set<string>();
  private inventory = { tokens: 0n, sats: 0n, usdc: new Map<EvmChainKey, bigint>(), at: 0 };

  constructor(
    private cfg: SolverConfig,
    private store: SwapStore,
    private bch: BchSide,
    private evm: Map<EvmChainKey, EvmSide>,
  ) {
    this.events.setMaxListeners(1000);
  }

  // ---------------------------------------------------------------- public API

  async info(): Promise<SolverInfo> {
    await this.refreshInventory();
    const pusd = Number(this.inventory.tokens);
    const reserved = this.reserved();
    const capacity: SolverInfo['capacity'] = {};
    const usdc: Record<string, number> = {};
    for (const [key, side] of this.evm) {
      const bal = Number((this.inventory.usdc.get(key) ?? 0n) / USDC_UNITS_PER_PUSD_UNIT);
      usdc[key] = bal;
      capacity[key] = {
        in: Math.max(0, Math.min(this.cfg.swapMax, pusd - reserved.tokens)),
        out: Math.max(0, Math.min(this.cfg.swapMax, bal - (reserved.usdc.get(key) ?? 0))),
      };
      void side;
    }
    return {
      name: this.cfg.publicName,
      bchNetwork: this.cfg.bchNetwork,
      chains: [...this.evm.values()].map((s) => ({
        key: s.chain.key, chainId: s.chain.chainId, htlc: s.chain.htlc, usdc: s.chain.usdc, explorer: s.chain.explorer,
      })),
      feeBps: this.cfg.feeBps,
      minFee: this.cfg.minFee,
      capacity,
      instantTierMax: this.cfg.instantMax,
      inventory: { pusd, bchSats: this.inventory.sats.toString(), usdc },
      pusdCategory: this.cfg.tokenCategory,
      version: '0.1.0',
    };
  }

  async quote(q: QuoteRequest): Promise<Quote> {
    const side = this.side(q.chain);
    if (!Number.isInteger(q.amount) || q.amount <= 0) throw new UserError('amount must be a positive number of cents');
    const info = await this.info();
    const cap = info.capacity[q.chain]![q.direction];
    if (q.amount > cap) throw new UserError(`the solver can fill at most ${cap} cents in this direction right now`);
    const fee = quoteFee(q.amount, this.cfg.feeBps, this.cfg.minFee);
    if (fee >= q.amount) throw new UserError('amount too small to cover the fee');
    return {
      direction: q.direction,
      chain: q.chain,
      amountIn: q.amount,
      amountOut: q.amount - fee,
      fee,
      tier: q.amount <= this.cfg.instantMax ? 'instant' : 'confirmed',
      expiresAt: now() + 600,
      solver: { bchAddress: this.bch.address, bchTokenAddress: this.bch.tokenAddress, evmAddress: side.address },
      htlc: side.chain.htlc,
      usdc: side.chain.usdc,
      bchNetwork: this.cfg.bchNetwork,
    };
  }

  /**
   * USDC -> PUSD. The user signed a gasless authorization that locks their USDC to us under
   * `secretHash`. We relay it, wait for it to land, then lock PUSD to the user under the same hash.
   */
  async openIn(body: OpenInSwap): Promise<SwapRecord> {
    const side = this.side(body.chain);
    const t = now();
    const secretHash = normHash(body.secretHash);
    if (this.store.get(secretHash)) throw new UserError('a swap with this secret hash already exists');
    const quote = await this.quote({ direction: 'in', chain: body.chain, amount: body.amount });
    checkWindow(body.evmRefundTime, t + TIMEOUTS.inEvmRefundSeconds, 'EVM refund time');
    if (body.validBefore < t + 60 || body.validBefore > t + 3_600) throw new UserError('authorization must stay valid for 1-60 minutes');
    const userBytecode = userAddressBytecode(body.userBchAddress);

    const amountUsdc = BigInt(body.amount) * USDC_UNITS_PER_PUSD_UNIT;
    const evmParams = {
      chainId: side.chain.chainId, htlc: side.chain.htlc, token: side.chain.usdc,
      sender: body.userEvm, recipient: side.address, amount: amountUsdc,
      secretHash: `0x${secretHash}` as Hex, refundTime: BigInt(body.evmRefundTime),
    };
    const lockId = computeLockId(evmParams);

    const swap: SwapRecord = {
      id: secretHash, direction: 'in', chain: body.chain, status: 'awaiting_user_lock', tier: quote.tier,
      amountIn: body.amount, amountOut: quote.amountOut, fee: quote.fee, secretHash,
      user: { bchAddress: body.userBchAddress, evmAddress: body.userEvm },
      // The BCH lock's refund time (and so its address) is fixed when the solver actually locks.
      bch: {
        lockAddress: '', refundTime: 0,
        claimBytecode: binToHex(userBytecode), refundBytecode: binToHex(this.bch.bytecode), tokenAmount: quote.amountOut,
      },
      evm: {
        htlc: side.chain.htlc, lockId, refundTime: body.evmRefundTime, amount: amountUsdc.toString(),
        sender: body.userEvm, recipient: side.address,
      },
      createdAt: t, updatedAt: t, timeline: [{ at: t, event: 'Swap opened: USDC -> PUSD', chain: body.chain }],
    };

    // Relay now so a bad signature fails the request instead of a background job.
    const hash = await side.relayUserLock({
      from: body.userEvm, recipient: side.address, amount: amountUsdc, secretHash: `0x${secretHash}`,
      refundTime: BigInt(body.evmRefundTime), validAfter: 0n, validBefore: BigInt(body.validBefore), signature: body.signature,
    });
    swap.evm.lockTx = hash;
    this.log(swap, { event: 'Your USDC lock was submitted (relayer paid the gas)', chain: body.chain, txid: hash });
    this.save(swap);
    void this.advance(swap.id);
    return swap;
  }

  /**
   * PUSD -> USDC. The user already broadcast a BCH lock that pays us under `secretHash`. We check
   * it is really there, wait for the tier's safety condition, then lock USDC to the user.
   */
  async openOut(body: OpenOutSwap): Promise<SwapRecord> {
    const side = this.side(body.chain);
    const t = now();
    const secretHash = normHash(body.secretHash);
    if (this.store.get(secretHash)) throw new UserError('a swap with this secret hash already exists');
    const quote = await this.quote({ direction: 'out', chain: body.chain, amount: body.amount });
    checkWindow(body.bchRefundTime, t + TIMEOUTS.outBchRefundSeconds, 'BCH refund time');
    const userBytecode = userAddressBytecode(body.userBchAddress);
    const bchParams: BchLockParams = {
      secretHash: hexToBin(secretHash), claimBytecode: this.bch.bytecode, refundBytecode: userBytecode,
      refundTime: BigInt(body.bchRefundTime),
    };
    const sighting = await this.bch.sight(bchParams, {
      category: this.cfg.tokenCategory, amount: BigInt(body.amount), minSats: LOCK_SATS / 2n, txid: body.lockTxid,
    });
    if (!sighting) throw new UserError('no matching lock found at the expected address; wrong parameters or not broadcast yet');
    // The EVM payout address must come from the lock transaction itself (signed by the lock's owner).
    const memo = parseLockMemo(await this.bch.provider.getRawTransaction(body.lockTxid));
    if (!memo || memo.chainId !== side.chain.chainId || memo.evmAddress.toLowerCase() !== body.userEvm.toLowerCase()) {
      throw new UserError('the lock transaction does not commit to this EVM payout address and chain');
    }

    const amountUsdc = BigInt(quote.amountOut) * USDC_UNITS_PER_PUSD_UNIT;
    const swap: SwapRecord = {
      id: secretHash, direction: 'out', chain: body.chain, status: 'user_locked', tier: quote.tier,
      amountIn: body.amount, amountOut: quote.amountOut, fee: quote.fee, secretHash,
      user: { bchAddress: body.userBchAddress, evmAddress: body.userEvm },
      bch: {
        lockAddress: this.bch.contract(bchParams).tokenAddress, refundTime: body.bchRefundTime,
        claimBytecode: binToHex(this.bch.bytecode), refundBytecode: binToHex(userBytecode), tokenAmount: body.amount,
        lockTxid: body.lockTxid,
      },
      // The EVM lock's refund time (and so its id) is fixed when the solver actually locks.
      evm: {
        htlc: side.chain.htlc, lockId: '', refundTime: 0, amount: amountUsdc.toString(),
        sender: side.address, recipient: body.userEvm,
      },
      createdAt: t, updatedAt: t,
      timeline: [
        { at: t, event: 'Swap opened: PUSD -> USDC', chain: 'bch' },
        { at: t, event: `Your PUSD is locked on Bitcoin Cash (${sighting.confirmations} conf)`, chain: 'bch', txid: body.lockTxid },
      ],
    };
    this.save(swap);
    void this.advance(swap.id);
    return swap;
  }

  /** PUSD -> USDC: the user hands us the secret; we claim their USDC for them (we pay gas). */
  async reveal(id: string, secretHex: string): Promise<SwapRecord> {
    const swap = this.must(id);
    const secret = hexToBin(secretHex.replace(/^0x/, ''));
    if (binToHex(hashSecret(secret)) !== swap.secretHash) throw new UserError('secret does not match this swap');
    if (swap.direction !== 'out') throw new UserError('only PUSD -> USDC swaps take a reveal');
    if (swap.status !== 'solver_locked') throw new UserError(`swap is ${swap.status}, cannot reveal now`);
    swap.secret = binToHex(secret);
    const side = this.side(swap.chain);
    const hash = await side.claim(swap.evm.lockId as Hex, `0x${swap.secret}`);
    swap.evm.spendTx = hash;
    swap.status = 'secret_revealed';
    this.log(swap, { event: 'Your USDC claim was submitted (relayer paid the gas)', chain: swap.chain, txid: hash });
    this.save(swap);
    void this.advance(swap.id);
    return swap;
  }

  /** USDC -> PUSD: the browser tells us its claim txid so we don't wait for the next poll. */
  async claimed(id: string, txid: string): Promise<SwapRecord> {
    const swap = this.must(id);
    if (swap.direction !== 'in') throw new UserError('only USDC -> PUSD swaps report a BCH claim');
    if (!swap.bch.spendTxid) swap.bch.spendTxid = txid;
    this.save(swap);
    void this.advance(swap.id);
    return swap;
  }

  get(id: string) { return this.store.get(normHash(id)); }
  list(limit: number) { return this.store.recent(Math.min(limit, 200)); }

  /** Walk every open swap once. Safe to call often; each swap is processed by one worker at a time. */
  async tick() {
    await Promise.all(this.store.open().map((s) => this.advance(s.id)));
  }

  // ---------------------------------------------------------------- state machine

  private async advance(id: string): Promise<void> {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const swap = this.store.get(id);
      if (!swap || TERMINAL.includes(swap.status)) return;
      if (swap.direction === 'in') await this.advanceIn(swap);
      else await this.advanceOut(swap);
    } catch (err) {
      const swap = this.store.get(id);
      if (swap) {
        const msg = publicMessage(err);
        const last = swap.timeline[swap.timeline.length - 1];
        if (last?.note !== msg) this.log(swap, { event: 'Retrying after an error', note: msg });
        this.save(swap);
      }
    } finally {
      this.busy.delete(id);
    }
  }

  private async advanceIn(swap: SwapRecord) {
    const side = this.side(swap.chain);
    const bchParams = () => this.bchParams(swap);

    if (swap.status === 'awaiting_user_lock') {
      await side.waitFor(swap.evm.lockTx as Hex, side.chain.confirmations);
      const lock = await side.readLock(swap.evm.lockId as Hex);
      if (lock.state !== LockState.Open || lock.amount !== BigInt(swap.evm.amount) || lock.recipient !== side.address) {
        swap.status = 'failed';
        this.log(swap, { event: 'User lock does not match the swap; nothing was sent', chain: swap.chain });
        return this.save(swap);
      }
      swap.status = 'user_locked';
      this.log(swap, { event: 'Your USDC is locked on-chain', chain: swap.chain, txid: swap.evm.lockTx });
      this.save(swap);
    }

    if (swap.status === 'user_locked') {
      // Fix the BCH lock's parameters exactly once and persist them before broadcasting, so a retry
      // targets the same lock address and can never lock our PUSD twice under one secret.
      if (!swap.bch.refundTime) {
        const refundTime = now() + TIMEOUTS.inBchRefundSeconds;
        // BCH refunds trail wall-clock by up to ~1h (MTP), and we need time to claim USDC afterwards.
        if (swap.evm.refundTime - refundTime < MIN_CLAIM_MARGIN + MTP_LAG) {
          swap.status = 'refunding';
          this.log(swap, { event: 'Too close to your refund time to lock safely; your USDC will be refunded', chain: swap.chain });
          return this.save(swap);
        }
        swap.bch.refundTime = refundTime;
        swap.bch.lockAddress = this.bch.contract(this.bchParams(swap)).tokenAddress;
        this.save(swap);
      }
      const params = this.bchParams(swap);
      const expect = this.bchExpect(swap);
      // Only our own funding transaction counts. Dust or junk sent to the lock address by anyone
      // else is ignored, because the lock must match the exact txid we built and persisted.
      // Our persisted lock tx is known to the network (mempool or chain): we are locked, even if the
      // user has already claimed it and the UTXO is gone.
      if (swap.bch.lockTxid && ((await this.bch.sight(params, expect)) || (await this.bch.txKnown(swap.bch.lockTxid)))) {
        swap.status = 'solver_locked';
        this.log(swap, { event: 'Solver locked PUSD for you on Bitcoin Cash', chain: 'bch', txid: swap.bch.lockTxid });
        return this.save(swap);
      }
      if (swap.bch.lockHex) {
        if (swap.bch.lockAttemptAt && now() - swap.bch.lockAttemptAt < 30) return; // let the indexer catch up
        swap.bch.lockAttemptAt = now();
        this.save(swap);
        try {
          await this.bch.broadcast(swap.bch.lockHex);
        } catch (err) {
          // Only rebuild if the network has never seen our lock tx AND it can no longer be broadcast
          // (its inputs went to another transaction). A known tx means we are already locked.
          if (!(await this.bch.txKnown(swap.bch.lockTxid!)) && /missing|spent|conflict/i.test(String((err as Error).message))) {
            swap.bch.lockHex = undefined;
            swap.bch.lockTxid = undefined;
            this.save(swap);
          }
          throw err;
        }
        return;
      }
      const built = await this.bch.buildTokenLock(params, BigInt(swap.bch.tokenAmount));
      swap.bch.lockHex = built.hex;
      swap.bch.lockTxid = built.txid;
      swap.bch.lockAttemptAt = now();
      this.save(swap);
      await this.bch.broadcast(built.hex);
      swap.status = 'solver_locked';
      this.log(swap, { event: 'Solver locked PUSD for you on Bitcoin Cash', chain: 'bch', txid: built.txid });
      return this.save(swap);
    }

    if (swap.status === 'solver_locked' || swap.status === 'secret_revealed') {
      const found = await this.bch.findClaimSecret(bchParams(), swap.bch.lockTxid);
      if (found) {
        swap.secret = binToHex(found.secret);
        swap.bch.spendTxid = found.txid;
        if (swap.status === 'solver_locked') {
          swap.status = 'secret_revealed';
          this.log(swap, { event: 'You claimed your PUSD (the secret is now public)', chain: 'bch', txid: found.txid });
          this.save(swap);
        }
        const lock = await side.readLock(swap.evm.lockId as Hex);
        if (lock.state === LockState.Open) {
          const hash = await side.claim(swap.evm.lockId as Hex, `0x${swap.secret}`);
          await side.waitFor(hash);
          swap.evm.spendTx = hash;
        }
        swap.status = 'completed';
        this.log(swap, { event: 'Solver collected the USDC with the same secret. Swap complete.', chain: swap.chain, txid: swap.evm.spendTx });
        return this.save(swap);
      }
      // Nobody claimed: once BCH time allows, return our PUSD; the user's USDC refund follows on EVM.
      if (swap.status === 'solver_locked' && (await this.bch.medianTimePast()) > swap.bch.refundTime) {
        const txid = await this.bch.spend(bchParams(), this.bchExpect(swap), 'refund');
        swap.bch.spendTxid = txid;
        swap.bch.refunded = true;
        swap.status = 'refunding';
        this.log(swap, { event: 'Timed out: solver PUSD lock refunded', chain: 'bch', txid });
        return this.save(swap);
      }
    }

    if (swap.status === 'refunding') {
      if (now() >= swap.evm.refundTime) {
        const lock = await side.readLock(swap.evm.lockId as Hex);
        if (lock.state === LockState.Open) {
          const hash = await side.refund(swap.evm.lockId as Hex);
          await side.waitFor(hash);
          swap.evm.spendTx = hash;
        }
        swap.evm.refunded = true;
        swap.status = 'refunded';
        this.log(swap, { event: 'Your USDC was refunded to you', chain: swap.chain, txid: swap.evm.spendTx });
        return this.save(swap);
      }
    }
  }

  private async advanceOut(swap: SwapRecord) {
    const side = this.side(swap.chain);
    const bchParams = this.bchParams(swap);

    if (swap.status === 'user_locked') {
      const sighting = await this.bch.sight(bchParams, this.bchExpect(swap));
      if (!sighting) {
        // The user's lock vanished before we acted: double-spent or already refunded. Stop here.
        swap.status = 'failed';
        this.log(swap, { event: 'Your BCH lock is no longer on-chain; solver did not lock USDC', chain: 'bch' });
        return this.save(swap);
      }
      // Fix the EVM lock's parameters exactly once, before the first send. Identical parameters give an
      // identical lock id, which the contract refuses to open twice, so a retry can never double-pay.
      if (!swap.evm.lockId) {
        const ready = swap.tier === 'instant'
          ? Date.now() >= swap.createdAt * 1000 + this.cfg.dsproofWaitMs && !(await this.bch.hasDoubleSpendProof(sighting.utxo.txid))
          : sighting.confirmations >= 1;
        if (!ready) return;
        if (swap.tier === 'instant') this.log(swap, { event: 'No double-spend proof after the safety window; filling instantly', chain: 'bch' });
        const refundTime = now() + TIMEOUTS.outEvmRefundSeconds;
        // We must be able to claim the user's PUSD after they reveal, before their BCH refund opens.
        if (swap.bch.refundTime - refundTime < MIN_CLAIM_MARGIN) {
          swap.status = 'refunding';
          this.log(swap, { event: 'Too close to your BCH refund time to lock safely; your PUSD refunds automatically', chain: 'bch' });
          return this.save(swap);
        }
        swap.evm.refundTime = refundTime;
        swap.evm.lockId = computeLockId({
          chainId: side.chain.chainId, htlc: side.chain.htlc, token: side.chain.usdc,
          sender: side.address, recipient: swap.evm.recipient as Address, amount: BigInt(swap.evm.amount),
          secretHash: `0x${swap.secretHash}`, refundTime: BigInt(refundTime),
        });
        this.save(swap);
      }
      const existing = await side.readLock(swap.evm.lockId as Hex);
      if (existing.state === LockState.None) {
        if (swap.evm.lockTx && (await side.txPending(swap.evm.lockTx as Hex))) return; // still in flight
        if (swap.evm.lockAttemptAt && now() - swap.evm.lockAttemptAt < 90) return; // a send may still be in flight
        if (now() >= swap.evm.refundTime - MIN_CLAIM_MARGIN / 3) {
          swap.status = 'refunding';
          this.log(swap, { event: 'Could not lock USDC in time; your PUSD refunds automatically', chain: 'bch' });
          return this.save(swap);
        }
        swap.evm.lockAttemptAt = now();
        this.save(swap);
        const hash = await side.solverLock(
          swap.evm.recipient as Address, BigInt(swap.evm.amount), `0x${swap.secretHash}`, BigInt(swap.evm.refundTime),
        );
        swap.evm.lockTx = hash;
        this.save(swap);
        await side.waitFor(hash);
      }
      swap.status = 'solver_locked';
      this.log(swap, { event: 'Solver locked USDC for you', chain: swap.chain, txid: swap.evm.lockTx });
      return this.save(swap);
    }

    if (swap.status === 'solver_locked') {
      const lock = await side.readLock(swap.evm.lockId as Hex);
      if (lock.state === LockState.Claimed && !swap.secret) {
        // The user claimed on-chain themselves; read the secret from the event logs.
        const secret = await this.claimedSecret(side, swap.evm.lockId as Hex);
        if (secret) {
          swap.secret = secret.slice(2);
          swap.status = 'secret_revealed';
          this.log(swap, { event: 'You claimed your USDC on-chain', chain: swap.chain });
          this.save(swap);
        }
      } else if (lock.state === LockState.Open && now() >= swap.evm.refundTime) {
        const hash = await side.refund(swap.evm.lockId as Hex);
        await side.waitFor(hash);
        swap.evm.spendTx = hash;
        swap.evm.refunded = true;
        swap.status = 'refunding';
        this.log(swap, { event: 'Timed out: solver USDC lock refunded', chain: swap.chain, txid: hash });
        return this.save(swap);
      }
    }

    if (swap.status === 'secret_revealed' && swap.secret) {
      if (swap.evm.spendTx) await side.waitFor(swap.evm.spendTx as Hex).catch(() => undefined);
      const txid = await this.bch.spend(bchParams, this.bchExpect(swap), 'claim', hexToBin(swap.secret));
      swap.bch.spendTxid = txid;
      swap.status = 'completed';
      this.log(swap, { event: 'Solver collected the PUSD with the same secret. Swap complete.', chain: 'bch', txid });
      return this.save(swap);
    }

    if (swap.status === 'refunding') {
      // Before returning the user's PUSD, make sure our USDC lock (if one ever landed) is settled:
      // if the user claimed it, we take the PUSD with the revealed secret instead.
      if (swap.evm.lockId) {
        if (swap.evm.lockTx && (await side.txPending(swap.evm.lockTx as Hex))) return;
        const lock = await side.readLock(swap.evm.lockId as Hex);
        if (lock.state === LockState.Claimed) {
          const secret = await this.claimedSecret(side, swap.evm.lockId as Hex);
          if (secret) {
            swap.secret = secret.slice(2);
            swap.status = 'secret_revealed';
            this.log(swap, { event: 'You claimed your USDC on-chain', chain: swap.chain });
            return this.save(swap);
          }
          return;
        }
        if (lock.state === LockState.Open) {
          if (now() < swap.evm.refundTime) return;
          const hash = await side.refund(swap.evm.lockId as Hex);
          await side.waitFor(hash);
          swap.evm.spendTx = hash;
          swap.evm.refunded = true;
          this.log(swap, { event: 'Timed out: solver USDC lock refunded', chain: swap.chain, txid: hash });
          this.save(swap);
        }
      }
      // Return the user's PUSD as soon as BCH time allows. Anyone could do this; we do it for them.
      if ((await this.bch.medianTimePast()) > swap.bch.refundTime) {
        const txid = await this.bch.spend(bchParams, this.bchExpect(swap), 'refund');
        swap.bch.spendTxid = txid;
        swap.bch.refunded = true;
        swap.status = 'refunded';
        this.log(swap, { event: 'Your PUSD was refunded to you', chain: 'bch', txid });
        return this.save(swap);
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  /** The secret from the Claimed event of an EVM lock, if it was claimed. */
  private async claimedSecret(side: EvmSide, id: Hex): Promise<Hex | undefined> {
    const logs = await side.pub.getContractEvents({
      address: side.chain.htlc, abi: htlcAbi, eventName: 'Claimed', args: { id }, fromBlock: side.deployBlock,
    });
    return (logs[0] as { args?: { secret?: Hex } } | undefined)?.args?.secret;
  }

  private bchParams(swap: SwapRecord): BchLockParams {
    return {
      secretHash: hexToBin(swap.secretHash),
      claimBytecode: hexToBin(swap.bch.claimBytecode),
      refundBytecode: hexToBin(swap.bch.refundBytecode),
      refundTime: BigInt(swap.bch.refundTime),
    };
  }

  private bchExpect(swap: SwapRecord) {
    return {
      category: this.cfg.tokenCategory, amount: BigInt(swap.bch.tokenAmount), minSats: LOCK_SATS / 2n,
      txid: swap.bch.lockTxid,
    };
  }

  private side(chain: EvmChainKey): EvmSide {
    const side = this.evm.get(chain);
    if (!side) throw new UserError(`chain ${chain} is not served by this solver`);
    return side;
  }

  private must(id: string): SwapRecord {
    const swap = this.store.get(normHash(id));
    if (!swap) throw new UserError('unknown swap');
    return swap;
  }

  private reserved() {
    const usdc = new Map<EvmChainKey, number>();
    let tokens = 0;
    for (const s of this.store.open()) {
      if (s.direction === 'in' && (s.status === 'awaiting_user_lock' || s.status === 'user_locked')) tokens += s.amountOut;
      if (s.direction === 'out' && s.status === 'user_locked') usdc.set(s.chain, (usdc.get(s.chain) ?? 0) + s.amountOut);
    }
    return { tokens, usdc };
  }

  private async refreshInventory() {
    if (Date.now() - this.inventory.at < 10_000) return;
    const inv = await this.bch.inventory();
    this.inventory.tokens = inv.tokens;
    this.inventory.sats = inv.sats;
    for (const [key, side] of this.evm) this.inventory.usdc.set(key, await side.usdcBalance());
    this.inventory.at = Date.now();
  }

  private log(swap: SwapRecord, e: Omit<TimelineEvent, 'at'>) {
    swap.timeline.push({ at: now(), ...e });
  }

  private save(swap: SwapRecord) {
    swap.updatedAt = now();
    this.store.put(swap);
    this.events.emit(swap.id, swap);
    this.events.emit('*', swap);
  }

  /** Exposed for the explorer: the solver's own addresses. */
  addresses() {
    return {
      bch: this.bch.address,
      bchToken: this.bch.tokenAddress,
      evm: Object.fromEntries([...this.evm].map(([k, s]) => [k, s.address])),
      bchFromBytecode: bytecodeToAddress(this.bch.bytecode, this.cfg.bchNetwork, true),
    };
  }
}

function normHash(h: string): string {
  const hex = h.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new UserError('secret hash must be 32 bytes of hex');
  return hex;
}

function checkWindow(value: number, nominal: number, what: string) {
  if (!Number.isInteger(value) || Math.abs(value - nominal) > TIMEOUT_SLACK) {
    throw new UserError(`${what} must be about ${Math.round((nominal - now()) / 3600)}h from now`);
  }
}

function userAddressBytecode(address: string): Uint8Array {
  try {
    return addressToBytecode(address);
  } catch {
    throw new UserError('invalid Bitcoin Cash address');
  }
}
