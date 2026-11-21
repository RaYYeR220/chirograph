// Move the solver's USDC between EVM chains with Circle's CCTP V2: burn on one chain, mint the same
// native USDC on another, no bridge and no wrapped token. Fast transfers settle in seconds.
//
//   pnpm --filter @chirograph/solver exec tsx --env-file=.env scripts/rebalance-usdc.ts <from> <to> <cents> [--standard]
//
// <from>/<to> are chain keys the solver serves (base, arbitrum, optimism, polygon). The minted USDC
// always goes to the solver's own address on <to>; anyone may relay the mint, but nobody can redirect it.
import { pad, parseAbi, type Address, type Hex } from 'viem';
import type { EvmChainKey } from '@chirograph/sdk';
import { loadConfig } from '../src/config.js';
import { EvmSide } from '../src/evm.js';

/** CCTP V2 contracts share one address on every EVM chain Circle supports. */
const TOKEN_MESSENGER = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as Address;
const MESSAGE_TRANSMITTER = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' as Address;
const IRIS = 'https://iris-api.circle.com';
/** Circle's domain id for each chain. */
const DOMAIN: Partial<Record<EvmChainKey, number>> = { optimism: 2, arbitrum: 3, base: 6, polygon: 7 };

const messengerAbi = parseAbi([
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);
const transmitterAbi = parseAbi([
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
  'function localDomain() view returns (uint32)',
]);
const erc20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

const [,, fromKey, toKey, centsStr, ...flags] = process.argv as [string, string, EvmChainKey, EvmChainKey, string, ...string[]];
const fast = !flags.includes('--standard');
const cents = Number(centsStr);
if (!Number.isInteger(cents) || cents <= 0) throw new Error('cents must be a positive integer');
if (fromKey === toKey) throw new Error('source and destination are the same chain');
const srcDomain = DOMAIN[fromKey];
const dstDomain = DOMAIN[toKey];
if (srcDomain === undefined || dstDomain === undefined) throw new Error('unsupported chain for CCTP');

const cfg = loadConfig();
const runtime = (k: EvmChainKey) => {
  const c = cfg.chains.find((x) => x.key === k);
  if (!c) throw new Error(`the solver does not serve ${k}`);
  return new EvmSide(c, cfg);
};
const src = runtime(fromKey);
const dst = runtime(toKey);
const me = src.account.address;
const amount = BigInt(cents) * 10_000n;

// The contracts must report the domains we think they are on.
for (const [side, want] of [[src, srcDomain], [dst, dstDomain]] as const) {
  const got = await side.pub.readContract({ address: MESSAGE_TRANSMITTER, abi: transmitterAbi, functionName: 'localDomain' });
  if (got !== want) throw new Error(`${side.chain.key}: transmitter reports domain ${got}, expected ${want}`);
}
const balance = await src.pub.readContract({ address: src.chain.usdc, abi: erc20, functionName: 'balanceOf', args: [me] });
if (balance < amount) throw new Error(`only ${Number(balance) / 1e6} USDC on ${fromKey}`);

// Fee for the chosen finality, in USDC base units, from Circle's own fee table (fast: a few bps).
const fees = await (await fetch(`${IRIS}/v2/burn/USDC/fees/${srcDomain}/${dstDomain}`)).json() as { finalityThreshold: number; minimumFee: number }[];
const threshold = fast ? 1000 : 2000;
const bps = fees.find((f) => f.finalityThreshold === threshold)?.minimumFee ?? 0;
const maxFee = fast ? (amount * BigInt(Math.ceil(bps * 100)) + 999_999n) / 1_000_000n + 1n : 0n;
console.log(`${fromKey} → ${toKey}: ${cents / 100} USDC, ${fast ? `fast (max fee ${Number(maxFee) / 1e6} USDC)` : 'standard'}`);

const approve = await src.wallet.writeContract({ address: src.chain.usdc, abi: erc20, functionName: 'approve', args: [TOKEN_MESSENGER, amount], chain: src.wallet.chain, account: src.account });
await src.pub.waitForTransactionReceipt({ hash: approve });
const burn = await src.wallet.writeContract({
  address: TOKEN_MESSENGER, abi: messengerAbi, functionName: 'depositForBurn',
  args: [amount, dstDomain, pad(me, { size: 32 }), src.chain.usdc, pad('0x', { size: 32 }), maxFee, threshold],
  chain: src.wallet.chain, account: src.account,
});
const burnReceipt = await src.pub.waitForTransactionReceipt({ hash: burn });
if (burnReceipt.status !== 'success') throw new Error(`burn reverted: ${burn}`);
console.log('burned', burn);

// Circle signs the burn message once it reaches the requested finality.
let message: Hex | undefined;
let attestation: Hex | undefined;
const t0 = Date.now();
while (!attestation) {
  await new Promise((r) => setTimeout(r, 3_000));
  const res = await fetch(`${IRIS}/v2/messages/${srcDomain}?transactionHash=${burn}`);
  if (!res.ok) continue;
  const m = (await res.json() as { messages?: { status: string; message: Hex; attestation: Hex }[] }).messages?.[0];
  if (m?.status === 'complete') { message = m.message; attestation = m.attestation; }
  if (Date.now() - t0 > 40 * 60_000) throw new Error(`no attestation after 40 minutes; mint later with the message for ${burn}`);
}
console.log(`attested after ${Math.round((Date.now() - t0) / 1000)} s`);

const mint = await dst.wallet.writeContract({
  address: MESSAGE_TRANSMITTER, abi: transmitterAbi, functionName: 'receiveMessage', args: [message!, attestation],
  chain: dst.wallet.chain, account: dst.account,
});
const mintReceipt = await dst.pub.waitForTransactionReceipt({ hash: mint });
console.log('minted', mint, mintReceipt.status);
// Public RPCs can lag a block behind the mint; wait briefly for the new balance to show.
let after = 0n;
for (let i = 0; i < 10; i++) {
  after = await dst.pub.readContract({ address: dst.chain.usdc, abi: erc20, functionName: 'balanceOf', args: [me] });
  if (after >= amount) break;
  await new Promise((r) => setTimeout(r, 1_500));
}
console.log(`${toKey} USDC now ${Number(after) / 1e6}`);
process.exit(0);
