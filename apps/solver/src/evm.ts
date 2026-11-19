import {
  createPublicClient, createWalletClient, http, maxUint256, parseEventLogs,
  type Address, type Hex, type PublicClient, type WalletClient, type Chain,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { base, arbitrum, baseSepolia, arbitrumSepolia } from 'viem/chains';
import { htlcAbi, erc20Abi, LockState, type EvmChainKey } from '@chirograph/sdk';
import { Mutex } from './mutex.js';
import type { ChainRuntime, SolverConfig } from './config.js';

const VIEM_CHAINS: Record<EvmChainKey, Chain> = {
  base, arbitrum, baseSepolia, arbitrumSepolia,
  baseFork: base, arbitrumFork: arbitrum,
};

export interface OnchainLock {
  sender: Address; recipient: Address; amount: bigint; secretHash: Hex; refundTime: bigint; state: LockState;
}

/** One EVM chain: the relayer for user locks and the solver's own USDC inventory. */
export class EvmSide {
  readonly pub: PublicClient;
  readonly wallet: WalletClient;
  readonly account: PrivateKeyAccount;
  private txLock = new Mutex();

  constructor(readonly chain: ChainRuntime, cfg: SolverConfig) {
    const viemChain = VIEM_CHAINS[chain.key];
    this.account = privateKeyToAccount(cfg.evmKey);
    this.pub = createPublicClient({ chain: viemChain, transport: http(chain.rpc) }) as PublicClient;
    this.wallet = createWalletClient({ chain: viemChain, transport: http(chain.rpc), account: this.account });
  }

  get address(): Address { return this.account.address; }

  /** First block to scan for escrow events (set HTLC_DEPLOY_BLOCK per chain to keep log queries cheap). */
  get deployBlock(): bigint { return BigInt(this.chain.deployBlock ?? 0); }

  /** 'success' / 'reverted' once mined, 'pending' while the node knows it, 'unknown' if it was dropped. */
  async receiptStatus(hash: Hex): Promise<'success' | 'reverted' | 'pending' | 'unknown'> {
    const receipt = await this.pub.getTransactionReceipt({ hash }).catch(() => undefined);
    if (receipt) return receipt.status === 'success' ? 'success' : 'reverted';
    const tx = await this.pub.getTransaction({ hash }).catch(() => undefined);
    return tx ? 'pending' : 'unknown';
  }

  /** True while a transaction is known to the node but not yet mined. */
  async txPending(hash: Hex): Promise<boolean> {
    const receipt = await this.pub.getTransactionReceipt({ hash }).catch(() => undefined);
    if (receipt) return false;
    const tx = await this.pub.getTransaction({ hash }).catch(() => undefined);
    return tx !== undefined;
  }

  async usdcBalance(): Promise<bigint> {
    return this.pub.readContract({ address: this.chain.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [this.address] });
  }

  async gasBalance(): Promise<bigint> {
    return this.pub.getBalance({ address: this.address });
  }

  async readLock(id: Hex): Promise<OnchainLock> {
    const [sender, recipient, amount, secretHash, refundTime, state] = await this.pub.readContract({
      address: this.chain.htlc, abi: htlcAbi, functionName: 'locks', args: [id],
    });
    return { sender, recipient, amount, secretHash, refundTime, state: state as LockState };
  }

  /** Submit the user's gasless EIP-3009 lock. The relayer pays gas; the signature pins every parameter. */
  async relayUserLock(a: {
    from: Address; recipient: Address; amount: bigint; secretHash: Hex; refundTime: bigint;
    validAfter: bigint; validBefore: bigint; signature: Hex;
  }): Promise<Hex> {
    return this.send({
      functionName: 'lockWithAuthorization',
      args: [a.from, a.recipient, a.amount, a.secretHash, a.refundTime, a.validAfter, a.validBefore, a.signature],
    });
  }

  /** Lock the solver's own USDC for the user. */
  async solverLock(recipient: Address, amount: bigint, secretHash: Hex, refundTime: bigint): Promise<Hex> {
    await this.ensureAllowance(amount);
    return this.send({ functionName: 'lock', args: [recipient, amount, secretHash, refundTime] });
  }

  async claim(id: Hex, secret: Hex): Promise<Hex> {
    return this.send({ functionName: 'claim', args: [id, secret] });
  }

  async refund(id: Hex): Promise<Hex> {
    return this.send({ functionName: 'refund', args: [id] });
  }

  async waitFor(hash: Hex, confirmations = 1) {
    const receipt = await this.pub.waitForTransactionReceipt({ hash, confirmations, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`);
    return receipt;
  }

  /** Read the secret from a Claimed event in a receipt (or undefined). */
  async secretFromClaim(hash: Hex): Promise<Hex | undefined> {
    const receipt = await this.pub.getTransactionReceipt({ hash });
    const logs = parseEventLogs({ abi: htlcAbi, logs: receipt.logs, eventName: 'Claimed' });
    return logs[0]?.args.secret;
  }

  async now(): Promise<number> {
    const block = await this.pub.getBlock();
    return Number(block.timestamp);
  }

  private async ensureAllowance(amount: bigint) {
    const allowance = await this.pub.readContract({
      address: this.chain.usdc, abi: erc20Abi, functionName: 'allowance', args: [this.address, this.chain.htlc],
    });
    if (allowance >= amount) return;
    const hash = await this.txLock.run(() => this.wallet.writeContract({
      address: this.chain.usdc, abi: erc20Abi, functionName: 'approve', args: [this.chain.htlc, maxUint256],
      chain: this.wallet.chain, account: this.account,
    }));
    await this.waitFor(hash);
  }

  private send(call: { functionName: 'lock' | 'lockWithAuthorization' | 'claim' | 'refund'; args: readonly unknown[] }): Promise<Hex> {
    return this.txLock.run(async () => {
      // Simulate first so a revert surfaces as a readable error before we spend gas.
      const { request } = await this.pub.simulateContract({
        address: this.chain.htlc, abi: htlcAbi, functionName: call.functionName as never, args: call.args as never, account: this.account,
      });
      return this.wallet.writeContract(request as never);
    });
  }
}
