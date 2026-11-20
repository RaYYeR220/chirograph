// Render every published number from proof/mainnet.json, so nothing in the README, PROOF.md,
// the site or the deck is typed by hand.
//
//   pnpm render:proof
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const proof = JSON.parse(readFileSync(root('proof/mainnet.json'), 'utf8'));

interface Swap {
  id: string; direction: 'USDC->PUSD' | 'PUSD->USDC'; chain: 'base' | 'arbitrum'; openedAt: number;
  amountInCents: number; amountOutCents: number; feeCents: number;
  msToFundsInWallet: number; msToSettled: number;
  evm: { lockTx: string; claimTx: string }; bch: { lockTx: string; claimTx: string };
}
const swaps = proof.swaps as Swap[];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const sec = (ms: number) => Math.round(ms / 100) / 10;
const ins = swaps.filter((s) => s.direction === 'USDC->PUSD');
const outs = swaps.filter((s) => s.direction === 'PUSD->USDC');
const measured = {
  source: `Median of ${swaps.length} mainnet swaps on Base and Arbitrum, timed by the swapping wallet`,
  swaps: swaps.length,
  inSeconds: sec(median(ins.map((s) => s.msToFundsInWallet))),
  inBest: sec(Math.min(...ins.map((s) => s.msToFundsInWallet))),
  inSettled: sec(median(ins.map((s) => s.msToSettled))),
  outSeconds: sec(median(outs.map((s) => s.msToFundsInWallet))),
  outBest: sec(Math.min(...outs.map((s) => s.msToFundsInWallet))),
  outSettled: sec(median(outs.map((s) => s.msToSettled))),
  volumeCents: swaps.reduce((a, s) => a + s.amountInCents, 0),
};
writeFileSync(root('apps/web/src/lib/measured.json'), `${JSON.stringify(measured, null, 2)}\n`);

const evmTx = (chain: string, h: string) => `[${h.slice(0, 10)}…](https://${chain === 'arbitrum' ? 'arbiscan.io' : 'basescan.org'}/tx/${h})`;
const bchTx = (h: string) => `[${h.slice(0, 8)}…](https://explorer.selene.cash/tx/${h})`;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const name = (c: string) => (c === 'arbitrum' ? 'Arbitrum' : 'Base');
const when = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

const summary = [
  '| Direction | Median time to funds | Best | Fully settled (median) | Signatures | Fee |',
  '|---|---|---|---|---|---|',
  `| USDC → PUSD | **${measured.inSeconds} s** | ${measured.inBest} s | ${measured.inSettled} s | 1 | 0.3%, min 1¢ |`,
  `| PUSD → USDC | **${measured.outSeconds} s** | ${measured.outBest} s | ${measured.outSettled} s | 1 | 0.3%, min 1¢ |`,
].join('\n');

const legs = (s: Swap) => s.direction === 'USDC->PUSD'
  ? `${evmTx(s.chain, s.evm.lockTx)} → ${bchTx(s.bch.lockTx)} → ${bchTx(s.bch.claimTx)} → ${evmTx(s.chain, s.evm.claimTx)}`
  : `${bchTx(s.bch.lockTx)} → ${evmTx(s.chain, s.evm.lockTx)} → ${evmTx(s.chain, s.evm.claimTx)} → ${bchTx(s.bch.claimTx)}`;
const table = [
  '| # | When (UTC) | Swap | Chain | In → out | To funds | Settled | Transactions, in order |',
  '|---|---|---|---|---|---|---|---|',
  ...swaps.map((s, i) => `| ${i + 1} | ${when(s.openedAt)} | ${s.direction.replace('->', ' → ')} | ${name(s.chain)} | ${usd(s.amountInCents)} → ${usd(s.amountOutCents)} | ${sec(s.msToFundsInWallet)} s | ${sec(s.msToSettled)} s | ${legs(s)} |`),
].join('\n');

function splice(file: string, tag: string, body: string) {
  const path = root(file);
  const text = readFileSync(path, 'utf8');
  const re = new RegExp(`(<!-- ${tag}:start -->)[\\s\\S]*?(<!-- ${tag}:end -->)`);
  if (!re.test(text)) throw new Error(`${file}: missing <!-- ${tag}:start --> marker`);
  writeFileSync(path, text.replace(re, `$1\n${body}\n$2`));
}
splice('README.md', 'summary', summary);
splice('README.md', 'swaps', table);
splice('PROOF.md', 'summary', summary);
splice('PROOF.md', 'swaps', table);

// The deck is static HTML; its measured numbers sit in elements tagged data-k.
const deckPath = root('apps/web/public/deck/index.html');
let deck = readFileSync(deckPath, 'utf8');
const setK = (k: string, v: string) => {
  const re = new RegExp(`(data-k="${k}">)[^<]*(<)`);
  if (!re.test(deck)) throw new Error(`deck: missing data-k="${k}"`);
  deck = deck.replace(re, `$1${v}$2`);
};
setK('in', `${measured.inSeconds} s`);
setK('out', `${measured.outSeconds} s`);
setK('src', `Chirograph: ${measured.source.toLowerCase()}. Baseline: THORChain quote API.`);
writeFileSync(deckPath, deck);

console.log(measured);
