import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import type { SwapRecord } from '@chirograph/sdk';
import { Page } from '../components/Shell';
import { useSolverInfo } from '../lib/hooks';
import { solver } from '../lib/swaps';
import { CONFIG, BCH_ADDRESS_URL } from '../lib/config';
import { EVM_ADDRESS_URL } from '../lib/evm';

const chainName = (key: string) => (key.startsWith('arbitrum') ? 'Arbitrum' : 'Base');
const ago = (t: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
/**
 * Seconds from the solver opening the swap to both sides being collected, on the solver's own clock
 * (whole seconds). The wallet-side "funds arrived" times are measured in the browser instead.
 */
function secondsToSettle(s: SwapRecord): number | null {
  if (s.status !== 'completed') return null;
  const ev = [...s.timeline].reverse().find((e) => /Swap complete/.test(e.event));
  return ev ? ev.at - s.createdAt : null;
}

export function Explorer() {
  const { info } = useSolverInfo(15_000);
  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [addrs, setAddrs] = useState<{ bch: string; evm: Record<string, string> } | null>(null);

  useEffect(() => {
    let alive = true;
    solver.list(100).then((l) => alive && setSwaps(l)).catch(() => undefined);
    fetch(`${CONFIG.solverUrl}/v1/solver`).then((r) => r.json()).then((a) => alive && setAddrs(a)).catch(() => undefined);
    const es = new EventSource(`${CONFIG.solverUrl}/v1/swaps/all/events`);
    es.onmessage = (e) => {
      const s = JSON.parse(e.data) as SwapRecord;
      setSwaps((prev) => [s, ...prev.filter((x) => x.id !== s.id)].sort((a, b) => b.createdAt - a.createdAt));
    };
    return () => { alive = false; es.close(); };
  }, []);

  const completed = swaps.filter((s) => s.status === 'completed');
  const times = completed.map(secondsToSettle).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : null;
  const volume = completed.reduce((v, s) => v + s.amountIn, 0);
  const cap = info ? Math.max(...Object.values(info.capacity).flatMap((c) => [c.in, c.out])) : null;

  return (
    <Page>
      <div className="page-h">
        <h1>Every swap</h1>
        <p>Every swap this solver has seen, live, with both chains' transactions. Nothing here is typed by hand: it is the solver's own record, and every step links to a block explorer. Times are on the solver's clock, from opening a swap to both sides collected; how fast funds reach a wallet is measured in the wallet, on the home page.</p>
      </div>
      <div className="stats">
        <div className="stat"><div className="k">Completed swaps</div><div className="v">{completed.length}</div></div>
        <div className="stat"><div className="k">Median time to settle</div><div className="v">{median !== null ? `${median} s` : '—'}</div></div>
        <div className="stat"><div className="k">Volume</div><div className="v">${(volume / 100).toFixed(2)}</div></div>
        <div className="stat"><div className="k">Solver can fill now</div><div className="v">{cap !== null ? `$${(cap / 100).toFixed(2)}` : '—'}</div></div>
      </div>
      <div className="card">
        {swaps.length === 0 ? <p className="card-pad" style={{ margin: 0, color: 'var(--muted)' }}>No swaps yet.</p> : (
          <ul className="swaplist">
            {swaps.map((s) => (
              <li key={s.id}><Link href={`/swap/${s.id}`}>
                <span className={`badge${s.status === 'completed' ? ' ok' : s.status === 'failed' ? ' bad' : ''}`}>{s.status.replace(/_/g, ' ')}</span>
                <span>{s.direction === 'in' ? `USDC (${chainName(s.chain)}) → PUSD` : `PUSD → USDC (${chainName(s.chain)})`}</span>
                <span className="amt">${(s.amountIn / 100).toFixed(2)}</span>
                <span className="t hide-sm">{secondsToSettle(s) !== null ? `settled in ${secondsToSettle(s)} s` : s.tier}</span>
                <span className="t">{ago(s.createdAt)}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </div>
      {addrs ? (
        <dl className="kv" style={{ marginTop: 20 }}>
          <dt>Solver on Bitcoin Cash</dt><dd><a href={BCH_ADDRESS_URL(addrs.bch)} target="_blank" rel="noreferrer">{addrs.bch}</a></dd>
          {info?.chains.map((c) => (
            <><dt key={`${c.key}-e`}>{chainName(c.key)} escrow</dt><dd key={`${c.key}-v`}><a href={EVM_ADDRESS_URL(c.chainId, c.htlc)} target="_blank" rel="noreferrer">{c.htlc}</a></dd></>
          ))}
        </dl>
      ) : null}
    </Page>
  );
}
