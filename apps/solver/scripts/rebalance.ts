// Move solver inventory between Bitcoin Cash and Base through THORChain.
//
//   pnpm --filter @chirograph/solver exec tsx scripts/rebalance.ts <bch-to-base|base-to-bch> <amount> [--dry] [--max-fee-bps 1500]
//
// <amount> is in the source asset: BCH for bch-to-base, USDC for base-to-bch. Reads the same .env as
// the solver. Prints THORChain's halt status and the quote, and sends nothing with --dry, while the
// route is halted, or when fees exceed the cap.
import { loadConfig } from '../src/config.js';
import { BchSide } from '../src/bch.js';
import { EvmSide } from '../src/evm.js';
import { plan, execute, track, routeStatus, type Direction } from '../src/rebalance.js';

const [,, dir, amountStr, ...rest] = process.argv;
if (dir !== 'bch-to-base' && dir !== 'base-to-bch') throw new Error('direction must be bch-to-base or base-to-bch');
const dry = rest.includes('--dry');
const capIdx = rest.indexOf('--max-fee-bps');
const maxFeeBps = capIdx >= 0 ? Number(rest[capIdx + 1]) : 1500;
const amount1e8 = BigInt(Math.round(Number(amountStr) * 1e8));

const cfg = loadConfig();
const bch = new BchSide(cfg);
await bch.provider.connect();
const baseRuntime = cfg.chains.find((c) => c.key === 'base');
if (!baseRuntime) throw new Error('CHAINS must include base');
const base = new EvmSide(baseRuntime, cfg);

console.log('THORChain status', await routeStatus(['BCH', 'BASE']));
let p;
try {
  p = await plan(dir as Direction, amount1e8, bch, base, maxFeeBps);
} catch (err) {
  console.log('not sending:', (err as Error).message);
  process.exit(2);
}
console.log({ direction: p.direction, amountIn: amountStr, expectedOut1e8: p.quote.expected_amount_out, feeBps: p.feeBps, seconds: p.quote.total_swap_seconds, memo: p.quote.memo });
if (dry) process.exit(0);
const txid = await execute(p, bch, base);
console.log('inbound', txid);
for (let i = 0; i < 120; i++) {
  const s = await track(txid).catch((e) => ({ done: false, stages: { error: String(e) }, outTxs: undefined }));
  if (s.done) { console.log('delivered', JSON.stringify(s.outTxs)); process.exit(0); }
  await new Promise((r) => setTimeout(r, 15_000));
}
console.log('still in flight; check', txid);
process.exit(0);
