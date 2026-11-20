// Sanity check for the THORChain client against the live network:
//   - price an open pair and run the full quote verification on it (must pass),
//   - the same quote with the destination or the vault swapped (must be refused),
//   - a halted route (must be refused before anything is priced).
//   pnpm --filter @chirograph/solver exec tsx scripts/thor-quote-check.ts
import { quote, routeStatus, checkQuote, THOR_ASSETS } from '../src/rebalance.js';

const ETH_USDC = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
const ours = '0x2eEa4EFaD1Ff5373b40E85EfbA9Cd40021793a17';
const cap = 1500;
let failures = 0;
const expect = async (name: string, shouldPass: boolean, fn: () => Promise<unknown>) => {
  try {
    await fn();
    console.log(`${shouldPass ? 'ok  ' : 'FAIL'} ${name}: accepted`);
    if (!shouldPass) failures++;
  } catch (err) {
    console.log(`${shouldPass ? 'FAIL' : 'ok  '} ${name}: refused (${(err as Error).message})`);
    if (shouldPass) failures++;
  }
};

console.log(await routeStatus(['BCH', 'BASE', 'ETH']));
const q = await quote(THOR_ASSETS.bch, ETH_USDC, 1_000_000n, ours, cap);
console.log('BCH -> ETH.USDC, 0.01 BCH:', { memo: q.memo, out1e8: q.expected_amount_out, feeBps: q.fees.total_bps, seconds: q.total_swap_seconds });
await expect('genuine quote', true, () => checkQuote(q, 'BCH', ETH_USDC, ours, cap));
await expect('memo paying someone else', false, () => checkQuote({ ...q, memo: q.memo.replace(ours, '0x000000000000000000000000000000000000dEaD') }, 'BCH', ETH_USDC, ours, cap));
await expect('vault swapped', false, () => checkQuote({ ...q, inbound_address: 'qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' }, 'BCH', ETH_USDC, ours, cap));
await expect('memo without a price limit', false, () => checkQuote({ ...q, memo: q.memo.split(':').slice(0, 3).join(':') }, 'BCH', ETH_USDC, ours, cap));
await expect('Base route while halted', false, () => quote(THOR_ASSETS.baseUsdc, THOR_ASSETS.bch, 90_000_000n, 'qqrqpmrjuhrd0yavzlw9py3q87t2h6la0u80lxvter', cap));
console.log(failures ? `${failures} check(s) misbehaved` : 'all checks behaved');
process.exit(failures ? 1 : 0);
