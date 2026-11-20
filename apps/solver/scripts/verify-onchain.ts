// Re-check every mainnet swap in proof/mainnet.json against the chains themselves.
//
//   pnpm verify:onchain
//
// For each swap it reads, from public nodes only:
//   EVM  - the Locked event (who, how much, which hash) and the Claimed event (the revealed secret)
//   BCH  - the lock output (PUSD category + amount at a P2SH32 covenant) and the claim input
//          that spends it, then pulls the 32-byte secret out of that input's unlocking script.
// A swap passes only if sha256(secret) equals the hash on both chains and the secret found on
// Bitcoin Cash is byte-for-byte the one revealed on the EVM side.
//
// A negative control runs last: it pairs one swap's EVM leg with another swap's BCH leg and must
// fail, so a green result cannot come from a check that accepts anything.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ElectrumNetworkProvider } from 'cashscript';
import { decodeTransaction, hexToBin, binToHex, sha256 } from '@bitauth/libauth';
import { createPublicClient, fallback, http, decodeEventLog, type Hex, type Address, type PublicClient } from 'viem';
import { base, arbitrum, optimism, polygon } from 'viem/chains';
import { htlcAbi, extractSecret, EVM_CHAINS } from '@chirograph/sdk';

interface ProofSwap {
  id: string; direction: string; chain: 'base' | 'arbitrum' | 'optimism' | 'polygon';
  amountInCents: number; amountOutCents: number; secretHash: string;
  evm: { htlc: Address; lockId: Hex; lockTx: Hex; claimTx: Hex; sender: Address; recipient: Address };
  bch: { lockTx: string; claimTx: string; tokenAmount: number; tokenCategory?: string };
}
const proofPath = fileURLToPath(new URL('../../../proof/mainnet.json', import.meta.url));
const proof = JSON.parse(readFileSync(proofPath, 'utf8')) as { pusdCategory: string; swaps: ProofSwap[] };

// Public endpoints for each chain (an env override first, if set), tried in order.
const VIEM = { base, arbitrum, optimism, polygon } as const;
const clients: Record<string, PublicClient> = Object.fromEntries((Object.keys(VIEM) as (keyof typeof VIEM)[]).map((k) => {
  const c = EVM_CHAINS[k];
  const urls = [process.env[`${k.toUpperCase()}_RPC_URL`], c.rpc, ...(c.rpcFallbacks ?? [])].filter((u): u is string => !!u);
  return [k, createPublicClient({ chain: VIEM[k], transport: fallback(urls.map((u) => http(u, { timeout: 15_000 }))) }) as PublicClient];
}));
const electrum = new ElectrumNetworkProvider('mainnet', { manualConnectionManagement: true });
await electrum.connect();
const tip = await electrum.getBlockHeight();

async function evmLeg(s: ProofSwap) {
  const pub = clients[s.chain]!;
  const [lockR, claimR] = await Promise.all([
    pub.getTransactionReceipt({ hash: s.evm.lockTx }),
    pub.getTransactionReceipt({ hash: s.evm.claimTx }),
  ]);
  const events = (r: typeof lockR) => r.logs
    .filter((l) => l.address.toLowerCase() === s.evm.htlc.toLowerCase())
    .map((l) => { try { return decodeEventLog({ abi: htlcAbi, data: l.data, topics: l.topics }); } catch { return undefined; } })
    .filter(Boolean) as { eventName: string; args: Record<string, unknown> }[];
  const locked = events(lockR).find((e) => e.eventName === 'Locked');
  const claimed = events(claimR).find((e) => e.eventName === 'Claimed');
  const head = await pub.getBlockNumber();
  return {
    ok: lockR.status === 'success' && claimR.status === 'success',
    lockId: locked?.args.id as Hex | undefined,
    claimedId: claimed?.args.id as Hex | undefined,
    hash: (locked?.args.secretHash as Hex | undefined)?.slice(2),
    amount: locked?.args.amount as bigint | undefined,
    recipient: locked?.args.recipient as Address | undefined,
    secret: (claimed?.args.secret as Hex | undefined)?.slice(2),
    confirmations: Number(head - claimR.blockNumber) + 1,
  };
}

async function bchLeg(s: ProofSwap, hash: string) {
  const lockHex = await electrum.getRawTransaction(s.bch.lockTx);
  const claimHex = await electrum.getRawTransaction(s.bch.claimTx);
  const lockTx = decodeTransaction(hexToBin(lockHex));
  const claimTx = decodeTransaction(hexToBin(claimHex));
  if (typeof lockTx === 'string' || typeof claimTx === 'string') throw new Error('cannot decode BCH transaction');
  const vout = lockTx.outputs.findIndex((o) =>
    o.token && binToHex(o.token.category) === (s.bch.tokenCategory ?? proof.pusdCategory) && o.token.amount === BigInt(s.bch.tokenAmount)
    && o.lockingBytecode.length === 35 && o.lockingBytecode[0] === 0xaa && o.lockingBytecode[1] === 0x20 && o.lockingBytecode[34] === 0x87);
  const spendsLock = vout >= 0 && claimTx.inputs.some((i) => binToHex(i.outpointTransactionHash) === s.bch.lockTx && i.outpointIndex === vout);
  const secret = extractSecret(claimHex, hexToBin(hash));
  const height = Number(await electrum.performRequest('blockchain.transaction.get_height', s.bch.claimTx));
  return { lockOutput: vout >= 0, spendsLock, secret: secret ? binToHex(secret) : undefined, confirmations: height > 0 ? tip - height + 1 : 0 };
}

function verdict(s: ProofSwap, evm: Awaited<ReturnType<typeof evmLeg>>, bch: Awaited<ReturnType<typeof bchLeg>>) {
  const checks: [string, boolean][] = [
    ['EVM lock and claim succeeded', evm.ok],
    ['EVM claim settles the same lock', !!evm.lockId && evm.lockId === evm.claimedId && evm.lockId.toLowerCase() === s.evm.lockId.toLowerCase()],
    ['EVM amount matches', evm.amount === BigInt(s.direction.startsWith('USDC->') ? s.amountInCents : s.amountOutCents) * 10_000n],
    ['sha256(EVM secret) = EVM hash', !!evm.secret && binToHex(sha256.hash(hexToBin(evm.secret))) === evm.hash],
    [`BCH lock holds ${s.direction.replace(/USDC|->/g, '')} in a P2SH32 covenant`, bch.lockOutput],
    ['BCH claim spends that lock', bch.spendsLock],
    ['same secret on both chains', !!bch.secret && bch.secret === evm.secret],
  ];
  return checks;
}

let failed = 0;
console.log(`Bitcoin Cash tip ${tip}. Checking ${proof.swaps.length} swaps.\n`);
for (const s of proof.swaps) {
  const evm = await evmLeg(s);
  const bch = await bchLeg(s, evm.hash ?? s.secretHash);
  const checks = verdict(s, evm, bch);
  const pass = checks.every(([, ok]) => ok);
  if (!pass) failed++;
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${s.direction.padEnd(10)} ${s.chain.padEnd(8)} ${usd(s.amountInCents)} -> ${usd(s.amountOutCents)}  secret ${evm.secret?.slice(0, 12) ?? '?'}…  conf evm ${evm.confirmations} / bch ${bch.confirmations || 'mempool'}`);
  for (const [name, ok] of checks) if (!ok) console.log(`      x ${name}`);
}

// Negative control: swap 0's EVM leg against swap 1's BCH leg must not verify.
if (proof.swaps.length >= 2) {
  const [a, b] = proof.swaps as [ProofSwap, ProofSwap];
  const evm = await evmLeg(a);
  const mixed = { ...a, bch: b.bch };
  const bch = await bchLeg(mixed, evm.hash!).catch(() => ({ lockOutput: false, spendsLock: false, secret: undefined, confirmations: 0 }));
  const pass = verdict(mixed, evm, bch).every(([, ok]) => ok);
  console.log(`\nnegative control (EVM leg of ${a.id.slice(0, 8)} with BCH leg of ${b.id.slice(0, 8)}): ${pass ? 'PASSED - the checker is broken' : 'rejected, as it must be'}`);
  if (pass) failed++;
}

console.log(failed ? `\n${failed} problem(s).` : `\nAll ${proof.swaps.length} swaps verified on-chain.`);
process.exit(failed ? 1 : 0);
