import { describe, it, expect } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo } from 'cashscript';
import { binToHex, hash160, hexToBin, secp256k1 } from '@bitauth/libauth';
import {
  PUSD_CATEGORY, LOCK_SATS, KEYLESS_SPEND_FEE,
  hashSecret, generateSecret, makeLockContract, buildKeylessSpend, extractSecret,
  buildSignedLockTx, buildWalletLockTx, addressToBytecode, bytecodeToAddress, computeLockId, to0x,
  type WalletUtxo,
} from '../src/index.js';

const key = (b: number) => new Uint8Array(32).fill(b);
const p2pkhOf = (priv: Uint8Array) =>
  hexToBin(`76a914${binToHex(hash160(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array))}88ac`);

const USER_KEY = key(0x21);
const SOLVER_KEY = key(0x42);
const USER = p2pkhOf(USER_KEY);
const SOLVER = p2pkhOf(SOLVER_KEY);

describe('secret', () => {
  it('matches the cross-chain test vector (sha256 of 32 x 0x11)', () => {
    const hash = hashSecret(new Uint8Array(32).fill(0x11));
    expect(binToHex(hash)).toBe('02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc');
  });
  it('rejects secrets that are not 32 bytes', () => {
    expect(() => hashSecret(new Uint8Array(31))).toThrow();
  });
  it('generates distinct 32-byte secrets', () => {
    const a = generateSecret(); const b = generateSecret();
    expect(a.length).toBe(32);
    expect(binToHex(a)).not.toBe(binToHex(b));
  });
});

describe('addresses', () => {
  it('round-trips bytecode through cashaddr', () => {
    const addr = bytecodeToAddress(USER, 'mainnet', true);
    expect(addr.startsWith('bitcoincash:z')).toBe(true);
    expect(binToHex(addressToBytecode(addr))).toBe(binToHex(USER));
  });
});

describe('bch lock lifecycle', () => {
  const secret = generateSecret();
  const params = {
    secretHash: hashSecret(secret),
    claimBytecode: USER,
    refundBytecode: SOLVER,
    refundTime: 1_800_000_000n,
  };

  it('solver locks PUSD, user claims keylessly, solver extracts the secret from the claim', async () => {
    const provider = new MockNetworkProvider();
    const lock = makeLockContract(params, provider);
    const solver = new SignatureTemplate(SOLVER_KEY);
    const solverAddr = bytecodeToAddress(SOLVER, 'mainnet', true);
    provider.addUtxo(binToHex(SOLVER), randomUtxo({ satoshis: 1_000n, token: { category: PUSD_CATEGORY, amount: 500n } }));
    provider.addUtxo(binToHex(SOLVER), randomUtxo({ satoshis: 50_000n }));
    const solverUtxos = await provider.getUtxosForLockingBytecode(SOLVER);

    const lockTx = buildSignedLockTx({
      provider, contract: lock, utxos: solverUtxos, unlocker: solver.unlockP2PKH(),
      token: { category: PUSD_CATEGORY, amount: 125n }, changeAddress: solverAddr,
    });
    await lockTx.send();

    const [lockUtxo] = await lock.getUtxos();
    expect(lockUtxo?.token?.amount).toBe(125n);
    expect(lockUtxo?.satoshis).toBe(LOCK_SATS);

    const claim = buildKeylessSpend({ provider, contract: lock, utxo: lockUtxo!, params, path: 'claim', secret });
    const claimHex = claim.build();
    await provider.sendRawTransaction(claimHex);

    const userUtxos = await provider.getUtxosForLockingBytecode(USER);
    expect(userUtxos[0]?.token?.amount).toBe(125n);
    expect(userUtxos[0]?.satoshis).toBe(LOCK_SATS - KEYLESS_SPEND_FEE);
    expect(binToHex(extractSecret(claimHex, params.secretHash)!)).toBe(binToHex(secret));
  });

  it('refund returns the lock to its funder once the time passes', async () => {
    const provider = new MockNetworkProvider();
    const lock = makeLockContract(params, provider);
    provider.addUtxo(lock.tokenAddress, randomUtxo({ satoshis: LOCK_SATS, token: { category: PUSD_CATEGORY, amount: 77n } }));
    const [utxo] = await lock.getUtxos();
    const refund = buildKeylessSpend({ provider, contract: lock, utxo: utxo!, params, path: 'refund' });
    await refund.send();
    const back = await provider.getUtxosForLockingBytecode(SOLVER);
    expect(back[0]?.token?.amount).toBe(77n);
  });

  it('builds a WizardConnect-ready user lock with token and BCH change', async () => {
    const provider = new MockNetworkProvider();
    const lock = makeLockContract({ ...params, claimBytecode: SOLVER, refundBytecode: USER }, provider);
    const userAddr = bytecodeToAddress(USER, 'mainnet', false);
    const userTokenAddr = bytecodeToAddress(USER, 'mainnet', true);
    const mk = (u: ReturnType<typeof randomUtxo>): WalletUtxo => ({
      ...u, lockingBytecode: binToHex(USER), address: userAddr, path: { chain: 'receive', index: 0 },
    });
    const utxos = [
      mk(randomUtxo({ satoshis: 800n, token: { category: PUSD_CATEGORY, amount: 300n } })),
      mk(randomUtxo({ satoshis: 20_000n })),
    ];
    const built = buildWalletLockTx({
      provider, contract: lock, utxos,
      token: { category: PUSD_CATEGORY, amount: 100n },
      changeAddress: userAddr, tokenChangeAddress: userTokenAddr,
    });
    expect(built.inputPaths).toEqual([[0, 'receive', 0], [1, 'receive', 0]]);
    expect(built.wc.transaction.outputs[0]!.token?.amount).toBe(100n);
    expect(built.wc.transaction.outputs[1]!.token?.amount).toBe(200n);
    expect(built.txHex.length).toBeGreaterThan(100);
    // wallet inputs are left unsigned; WizardConnect fills them in via inputPaths
    expect(built.wc.sourceOutputs.every((s) => s.unlockingBytecode.length === 0)).toBe(true);
    expect(built.wc.sourceOutputs.every((s) => !('contract' in s) || s.contract === undefined)).toBe(true);
  });
});

describe('evm lock id', () => {
  it('is deterministic and changes with every parameter', () => {
    const base = {
      chainId: 8453, htlc: '0x1111111111111111111111111111111111111111', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      sender: '0x2222222222222222222222222222222222222222', recipient: '0x3333333333333333333333333333333333333333',
      amount: 1_000_000n, secretHash: to0x(hashSecret(new Uint8Array(32).fill(0x11))), refundTime: 1_800_000_000n,
    } as const;
    const id = computeLockId(base);
    expect(id).toBe(computeLockId({ ...base }));
    expect(computeLockId({ ...base, recipient: '0x4444444444444444444444444444444444444444' })).not.toBe(id);
    expect(computeLockId({ ...base, amount: 1_000_001n })).not.toBe(id);
    expect(computeLockId({ ...base, chainId: 42161 })).not.toBe(id);
  });
});
