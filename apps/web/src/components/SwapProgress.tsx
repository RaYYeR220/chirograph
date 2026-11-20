import { useEffect, useState } from 'react';
import type { SwapRecord } from '@chirograph/sdk';
import { BCH_TX_URL } from '../lib/config';
import { EVM_TX_URL } from '../lib/evm';
import type { RunnerStage } from '../lib/hooks';

const ORDER: Record<string, number> = {
  awaiting_user_lock: 0, user_locked: 1, solver_locked: 2, secret_revealed: 3, completed: 4,
};

function chainIdOf(key: string) { return key.startsWith('arbitrum') ? 42161 : 8453; }
function chainName(key: string) { return key.startsWith('arbitrum') ? 'Arbitrum' : 'Base'; }

interface Step { title: string; detail: string; link?: { href: string; label: string } }

function stepsFor(s: SwapRecord): Step[] {
  const cid = chainIdOf(s.chain);
  const evm = (h?: string) => (h ? { href: EVM_TX_URL(cid, h), label: `${chainName(s.chain)} tx ↗` } : undefined);
  const bch = (h?: string) => (h ? { href: BCH_TX_URL(h), label: 'BCH tx ↗' } : undefined);
  const out = (s.amountOut / 100).toFixed(2), inn = (s.amountIn / 100).toFixed(2);
  if (s.direction === 'in') {
    return [
      { title: 'You signed once', detail: `Authorized ${inn} USDC into the escrow. The relayer paid the gas.` },
      { title: `USDC locked on ${chainName(s.chain)}`, detail: 'Refunds to you after 4 h if anything stalls.', link: evm(s.evm.lockTx) },
      { title: 'PUSD locked for you on Bitcoin Cash', detail: `${out} PUSD under the same hash, in a keyless covenant only your address can receive.`, link: bch(s.bch.lockTxid) },
      { title: 'You claimed your PUSD', detail: 'Your browser checked the lock, then claimed it with no key. The secret is now public.', link: bch(s.bch.spendTxid) },
      { title: 'Settled', detail: 'The solver reused the secret to collect the USDC.', link: evm(s.evm.spendTx) },
    ];
  }
  return [
    { title: 'You signed once', detail: `Your wallet locked ${inn} PUSD and named this USDC address in the same transaction.`, link: bch(s.bch.lockTxid) },
    { title: 'PUSD lock seen on Bitcoin Cash', detail: 'Refunds to you after 4 h if anything stalls. Instant tier: 4 s double-spend-proof window.' },
    { title: `USDC locked for you on ${chainName(s.chain)}`, detail: `${out} USDC under the same hash; your browser verified it on-chain.`, link: evm(s.evm.lockTx) },
    { title: 'Your USDC claimed to you', detail: 'Secret revealed only after the checks passed. The relayer paid the gas.', link: evm(s.evm.spendTx) },
    { title: 'Settled', detail: 'The solver reused the secret to collect the PUSD.', link: bch(s.bch.spendTxid) },
  ];
}

/** A placeholder swap used only to render the plan before anything starts. */
function planSwap(direction: 'in' | 'out'): SwapRecord {
  return {
    id: '', direction, chain: 'base', status: 'awaiting_user_lock', tier: 'instant', amountIn: 100, amountOut: 99, fee: 1, secretHash: '',
    user: {}, bch: { lockAddress: '', refundTime: 0, claimBytecode: '', refundBytecode: '', tokenAmount: 99 },
    evm: { htlc: '', lockId: '', refundTime: 0, amount: '0', sender: '', recipient: '' }, createdAt: 0, updatedAt: 0, timeline: [],
  };
}

function progressIndex(s: SwapRecord): number {
  const base = ORDER[s.status] ?? 0;
  // The out flow shows the BCH lock and its sighting as two steps.
  return s.direction === 'out' ? Math.min(4, base === 0 ? 0 : base + 1) : base;
}

export function SwapProgress({ swap, stage, error, note, started, fundsAt, plan }: {
  swap: SwapRecord | null; stage: RunnerStage; error: string | null; note: string | null; started: number | null;
  fundsAt?: number | null; plan?: 'in' | 'out';
}) {
  const [now, setNow] = useState(Date.now());
  const done = swap?.status === 'completed';
  const [doneAt, setDoneAt] = useState<number | null>(null);
  useEffect(() => { if (done && !doneAt) setDoneAt(Date.now()); if (!done) setDoneAt(null); }, [done, doneAt]);
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [done]);

  const elapsed = started ? ((doneAt ?? now) - started) / 1000 : null;
  // Funds can't arrive after the swap settled; the watcher may notice them a poll late.
  const arrivedAt = fundsAt && started ? Math.min(fundsAt, doneAt ?? fundsAt) : null;
  const refunding = swap && (swap.status === 'refunding' || swap.status === 'refunded');
  const failed = swap?.status === 'failed';
  const steps = swap ? stepsFor(swap) : [];
  const at = swap ? progressIndex(swap) : -1;

  return (
    <div className="card card-pad" aria-live="polite">
      <div className="status-head">
        <div>
          <div className="label">{swap ? (swap.direction === 'in' ? 'USDC → PUSD' : 'PUSD → USDC') : 'Your swap'}</div>
          <div className="big">{swap ? `${(swap.amountOut / 100).toFixed(2)} ${swap.direction === 'in' ? 'PUSD' : 'USDC'}` : '—'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {done ? <span className="badge ok">Done</span>
            : failed ? <span className="badge bad">Stopped</span>
              : refunding ? <span className="badge">Refunding</span>
                : stage === 'signing' ? <span className="badge run">Waiting for your signature</span>
                  : swap ? <span className="badge run">In progress</span> : <span className="badge">Not started</span>}
          {elapsed !== null && !refunding ? <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>{done ? 'settled in ' : ''}{elapsed.toFixed(1)} s</div> : null}
        </div>
      </div>

      {arrivedAt && started ? (
        <div className="notice info" style={{ marginTop: 0, marginBottom: 6, fontSize: 15 }}>
          Your {swap?.direction === 'out' ? 'USDC' : 'PUSD'} arrived <b className="mono" style={{ color: 'var(--ink)' }}>{((arrivedAt - started) / 1000).toFixed(1)} s</b> after you clicked. One signature.
        </div>
      ) : null}
      {swap ? (
        <ol className="tl">
          {steps.map((s, i) => (
            <li key={i} className={failed && i > at ? 'bad' : i < at || done ? 'done' : i === at ? 'on' : ''}>
              <span className="m" />
              <div><div className="t">{s.title}</div><div className="d">{s.detail}</div></div>
              <div className="x">{s.link && (i <= at || done) ? <a href={s.link.href} target="_blank" rel="noreferrer">{s.link.label}</a> : null}</div>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <p className="d" style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 6px' }}>You sign once. Everything below then happens on its own, and each step links to its transaction.</p>
          <ol className="tl">
            {stepsFor(planSwap(plan ?? 'in')).map((s, i) => (
              <li key={i}><span className="m" /><div><div className="t">{s.title}</div><div className="d">{s.detail}</div></div><div /></li>
            ))}
          </ol>
        </>
      )}

      {refunding && swap ? (
        <div className="notice info">
          Nothing was lost. Each side's lock returns to its owner after its timeout. Your {swap.direction === 'in' ? 'USDC refunds' : 'PUSD refunds'} after{' '}
          {new Date((swap.direction === 'in' ? swap.evm.refundTime : swap.bch.refundTime) * 1000).toLocaleTimeString()}; the solver's watchtower executes it for you, and anyone can.
        </div>
      ) : null}
      {stage === 'claim_yourself' ? <div className="notice err">The relayer has not claimed your USDC yet. Connect your EVM wallet and claim it directly; the secret is already public, so do it soon.</div> : null}
      {note ? <div className="notice info">{note}</div> : null}
      {error ? <div className="notice err">{error}</div> : null}
      {swap ? <dl className="kv"><dt>Swap</dt><dd>{swap.id}</dd><dt>Hash</dt><dd>SHA-256(secret) = {swap.secretHash}</dd></dl> : null}
    </div>
  );
}
