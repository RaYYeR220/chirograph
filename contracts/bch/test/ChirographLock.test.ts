import { describe, it, expect, beforeEach } from 'vitest';
import 'cashscript/vitest';
import { Contract, MockNetworkProvider, TransactionBuilder, SignatureTemplate, randomUtxo, randomToken } from 'cashscript';
import { sha256, binToHex, hexToBin, hash160, secp256k1 } from '@bitauth/libauth';
import artifact from '../artifacts/ChirographLock.json' with { type: 'json' };

// Plain P2PKH locking bytecode for a 20-byte hash; the covenant never checks signatures,
// so arbitrary hashes are enough to stand in for "Alice", "Solver" and "Mallory".
const p2pkh = (byte: number) => hexToBin(`76a914${byte.toString(16).padStart(2, '0').repeat(20)}88ac`);
const ALICE = p2pkh(0xa1);
const SOLVER = p2pkh(0x50);
const MALLORY = p2pkh(0x66);

const SECRET = hexToBin('11'.repeat(32));
const SECRET_HASH = sha256.hash(SECRET);
const REFUND_TIME = 1_800_000_000n; // unix seconds, compared against MTP via nLockTime
const MAX_FEE = 1_000n;
const LOCK_SATS = 2_000n;
const PUSD = randomToken({ amount: 125n }); // 1.25 PUSD (2 decimals)

let provider: MockNetworkProvider;
let lock: Contract<typeof artifact>;

function makeLock(opts: { claimTo?: Uint8Array; refundTo?: Uint8Array; maxFee?: bigint } = {}) {
  return new Contract(
    artifact,
    [SECRET_HASH, opts.claimTo ?? ALICE, opts.refundTo ?? SOLVER, REFUND_TIME, opts.maxFee ?? MAX_FEE],
    { provider, addressType: 'p2sh32' },
  );
}

function fund(contract: Contract<typeof artifact>, token = PUSD, satoshis = LOCK_SATS) {
  return provider.addUtxo(contract.tokenAddress, randomUtxo({ satoshis, token }));
}

beforeEach(() => {
  provider = new MockNetworkProvider();
  lock = makeLock();
});

describe('claim', () => {
  it('pays the recipient when the right secret is revealed', async () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: LOCK_SATS - 500n, token: PUSD });
    await expect(tx.send()).resolves.toBeDefined();
  });

  it('can be executed by a third party, the payout still lands on the recipient', async () => {
    // A relayer adds its own signed BCH input and change; the lock input sits at index 1,
    // so the covenant checks output 1.
    const relayerKey = new Uint8Array(32).fill(0x07);
    const relayer = new SignatureTemplate(relayerKey);
    const relayerBytecode = hexToBin(
      `76a914${binToHex(hash160(secp256k1.derivePublicKeyCompressed(relayerKey) as Uint8Array))}88ac`,
    );
    const relayerUtxo = provider.addUtxo(binToHex(relayerBytecode), randomUtxo({ satoshis: 10_000n }));
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(relayerUtxo, relayer.unlockP2PKH())
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: relayerBytecode, amount: 9_000n })
      .addOutput({ to: ALICE, amount: LOCK_SATS, token: PUSD });
    await expect(tx.send()).resolves.toBeDefined();
  });

  it('rejects a wrong secret', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(hexToBin('22'.repeat(32))))
      .addOutput({ to: ALICE, amount: LOCK_SATS - 500n, token: PUSD });
    expect(tx).toFailRequireWith('wrong secret');
  });

  it.each([31, 33, 0])('rejects a %i-byte secret (cross-chain length mismatch guard)', (len) => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(new Uint8Array(len).fill(0x11)))
      .addOutput({ to: ALICE, amount: LOCK_SATS - 500n, token: PUSD });
    expect(tx).toFailRequireWith('secret must be 32 bytes');
  });

  it('cannot be redirected to another address, even with the right secret', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: MALLORY, amount: LOCK_SATS - 500n, token: PUSD });
    expect(tx).toFailRequireWith('wrong destination');
  });

  it('cannot send the payout to the refund address', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: SOLVER, amount: LOCK_SATS - 500n, token: PUSD });
    expect(tx).toFailRequireWith('wrong destination');
  });

  it('cannot skim tokens into a second output', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: 900n, token: { ...PUSD, amount: 100n } })
      .addOutput({ to: MALLORY, amount: 700n, token: { ...PUSD, amount: 25n } });
    expect(tx).toFailRequireWith('token amount changed');
  });

  it('cannot strip the token from the payout', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: LOCK_SATS - 500n });
    expect(tx).toFailRequireWith('token category changed');
  });

  it('caps the miner fee the executor can burn', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: LOCK_SATS - MAX_FEE - 1n, token: PUSD });
    expect(tx).toFailRequireWith('fee above cap');
  });

  it('accepts a fee exactly at the cap', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: LOCK_SATS - MAX_FEE, token: PUSD });
    expect(tx).not.toFailRequire();
  });

  it('works for a plain BCH lock with no token', async () => {
    const utxo = provider.addUtxo(lock.address, randomUtxo({ satoshis: 50_000n }));
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: 49_500n });
    await expect(tx.send()).resolves.toBeDefined();
  });
});

describe('refund', () => {
  it('is impossible before the refund time', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.refund())
      .addOutput({ to: SOLVER, amount: LOCK_SATS - 500n, token: PUSD })
      .setLocktime(Number(REFUND_TIME) - 1);
    expect(tx).toFailRequire();
  });

  it('returns the coins to the refund address once the time has passed', async () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.refund())
      .addOutput({ to: SOLVER, amount: LOCK_SATS - 500n, token: PUSD })
      .setLocktime(Number(REFUND_TIME));
    await expect(tx.send()).resolves.toBeDefined();
  });

  it('cannot be redirected to the claim address or a third party', () => {
    for (const to of [ALICE, MALLORY]) {
      const utxo = fund(lock);
      const tx = new TransactionBuilder({ provider })
        .addInput(utxo, lock.unlock.refund())
        .addOutput({ to, amount: LOCK_SATS - 500n, token: PUSD })
        .setLocktime(Number(REFUND_TIME));
      expect(tx).toFailRequireWith('wrong destination');
    }
  });

  it('enforces the same fee cap', () => {
    const utxo = fund(lock);
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo, lock.unlock.refund())
      .addOutput({ to: SOLVER, amount: LOCK_SATS - MAX_FEE - 1n, token: PUSD })
      .setLocktime(Number(REFUND_TIME));
    expect(tx).toFailRequireWith('fee above cap');
  });
});

describe('batching', () => {
  it('settles two locks in one transaction, one payout per input', async () => {
    const lockB = makeLock({ claimTo: ALICE });
    const a = fund(lock);
    const b = fund(lockB, { ...PUSD, amount: 300n });
    const tx = new TransactionBuilder({ provider })
      .addInput(a, lock.unlock.claim(SECRET))
      .addInput(b, lockB.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: LOCK_SATS - 400n, token: PUSD })
      .addOutput({ to: ALICE, amount: LOCK_SATS - 400n, token: { ...PUSD, amount: 300n } });
    await expect(tx.send()).resolves.toBeDefined();
  });

  it('two locks cannot share one payout output', () => {
    const lockB = makeLock({ claimTo: ALICE });
    const a = fund(lock);
    const b = fund(lockB);
    // Both inputs would like output 0 to count for them; input 1 must find its own output.
    const tx = new TransactionBuilder({ provider })
      .addInput(a, lock.unlock.claim(SECRET))
      .addInput(b, lockB.unlock.claim(SECRET))
      .addOutput({ to: ALICE, amount: 2n * LOCK_SATS - 800n, token: { ...PUSD, amount: 250n } })
      .addOutput({ to: MALLORY, amount: 1_000n });
    expect(tx).toFailRequire();
  });
});

describe('size', () => {
  it('fits a pay-to-script output with room to spare (2026 P2S limit is 201 bytes)', () => {
    const redeemBytes = hexToBin(lock.bytecode).length;
    expect(redeemBytes).toBeLessThan(201);
  });
});
