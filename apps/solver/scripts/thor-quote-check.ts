// Sanity check for the THORChain client: price an open pair, and confirm a halted route is refused.
//   pnpm --filter @chirograph/solver exec tsx scripts/thor-quote-check.ts
import { quote, routeStatus, THOR_ASSETS } from '../src/rebalance.js';

console.log(await routeStatus(['BCH', 'BASE', 'ETH']));
const q = await quote(THOR_ASSETS.bch, 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 1_000_000n, '0x2eEa4EFaD1Ff5373b40E85EfbA9Cd40021793a17');
console.log('BCH -> ETH.USDC (0.01 BCH):', { memo: q.memo, out1e8: q.expected_amount_out, feeBps: q.fees.total_bps, seconds: q.total_swap_seconds, min1e8: q.recommended_min_amount_in });
try {
  await quote(THOR_ASSETS.baseUsdc, THOR_ASSETS.bch, 90_000_000n, 'qqrqpmrjuhrd0yavzlw9py3q87t2h6la0u80lxvter');
  console.log('BASE.USDC -> BCH: quoted');
} catch (err) {
  console.log('BASE.USDC -> BCH refused:', (err as Error).message);
}
