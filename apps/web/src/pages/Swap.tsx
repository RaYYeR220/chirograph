import { useCallback, useMemo, useRef, useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import type { Direction, EvmChainKey, Quote } from '@chirograph/sdk';
import { Page } from '../components/Shell';
import { BchWalletRow, EvmWalletRow, WizardDialog } from '../components/Wallets';
import { SwapProgress } from '../components/SwapProgress';
import { useBch, useSolverInfo, useSwapRunner } from '../lib/hooks';
import { FEE } from '../lib/facts';

// Development-only local signer (never present in production builds).
const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_EVM_KEY as Hex | undefined) : undefined;
const devAccount = devKey ? privateKeyToAccount(devKey) : undefined;

const chainIdOf = (key: string) => (key.startsWith('arbitrum') ? 42161 : 8453);
const chainName = (key: string) => (key.startsWith('arbitrum') ? 'Arbitrum' : 'Base');

export function Swap({ id }: { id?: string }) {
  const { info, error: solverError } = useSolverInfo(10_000);
  const bch = useBch(info?.pusdCategory);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const evmAddress = (devAccount?.address ?? address) as Address | undefined;

  const [direction, setDirection] = useState<Direction>('in');
  const [chain, setChain] = useState<EvmChainKey | null>(null);
  const [amount, setAmount] = useState('1.00');
  const [showQr, setShowQr] = useState(false);
  const [pending, setPending] = useState<Quote | null>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);

  const chains = info?.chains ?? [];
  const activeChain = (chain ?? chains[0]?.key ?? 'base') as EvmChainKey;
  const cents = Math.round(Number(amount) * 100);
  const fee = Math.max(FEE.minCents, Math.ceil((cents * FEE.bps) / 10_000));
  const cap = info?.capacity[activeChain]?.[direction] ?? 0;

  const deps = useMemo(() => ({
    info, bch, evmAddress,
    signTypedData: async (typed: Parameters<typeof signTypedDataAsync>[0]) => {
      if (devAccount) return devAccount.signTypedData(typed as never);
      await switchChainAsync({ chainId: Number((typed as { domain: { chainId: number } }).domain.chainId) as 8453 }).catch(() => undefined);
      return signTypedDataAsync(typed);
    },
    confirmQuote: (q: Quote) => new Promise<boolean>((resolve) => { setPending(q); decide.current = resolve; }),
    writeClaim: devAccount ? undefined : async (req: { address: Address; abi: never; functionName: 'claim'; args: [Hex, Hex]; chainId: number }) => {
      await switchChainAsync({ chainId: req.chainId as 8453 }).catch(() => undefined);
      return writeContractAsync(req as never);
    },
  }), [info, bch, evmAddress, signTypedDataAsync, switchChainAsync, writeContractAsync]);
  const runner = useSwapRunner(deps as never, id ?? null);

  const answer = useCallback((ok: boolean) => { decide.current?.(ok); decide.current = null; setPending(null); }, []);

  const busy = runner.stage === 'signing' || runner.stage === 'waiting_solver' || runner.stage === 'claiming';
  const needsBch = direction === 'out' || !bch.wallet;
  const canStart = !!info && !!evmAddress && !!bch.wallet && cents >= 25 && cents <= cap && !busy
    && (direction === 'in' || (bch.wallet?.tokens ?? 0n) >= BigInt(cents));
  const blocker = !info ? (solverError ? 'Solver unreachable right now.' : 'Connecting to the solver…')
    : !bch.wallet ? 'Connect a Bitcoin Cash wallet (it receives PUSD, or pays it).'
      : !evmAddress ? 'Connect an EVM wallet (it pays USDC, or receives it).'
        : cents < 25 ? 'The smallest swap is $0.25.'
          : cents > cap ? `The solver can fill up to $${(cap / 100).toFixed(2)} in this direction right now.`
            : direction === 'out' && (bch.wallet.tokens < BigInt(cents)) ? 'Not enough PUSD in this wallet.' : null;

  const from = direction === 'in' ? 'USDC' : 'PUSD';
  const to = direction === 'in' ? 'PUSD' : 'USDC';
  const fromChain = direction === 'in' ? chainName(activeChain) : 'Bitcoin Cash';
  const toChain = direction === 'in' ? 'Bitcoin Cash' : chainName(activeChain);

  return (
    <Page>
      <div className="page-h compact">
        <h1>Swap</h1>
        <p>One signature. Your browser holds the secret, checks the solver's lock on-chain, and only then reveals it. If anything stalls, both sides refund themselves.</p>
      </div>
      <div className="app-grid">
        <div className="card card-pad">
          <div className="seg" role="group" aria-label="Direction">
            <button type="button" aria-pressed={direction === 'in'} disabled={busy} onClick={() => setDirection('in')}>USDC → PUSD</button>
            <button type="button" aria-pressed={direction === 'out'} disabled={busy} onClick={() => setDirection('out')}>PUSD → USDC</button>
          </div>

          <div className="leg">
            <div className="leg-top">
              <span className="label">You send · {fromChain}</span>
              {direction === 'in' ? (
                <span className="chainpick">{chains.map((c) => (
                  <button key={c.key} type="button" className="chip" aria-pressed={activeChain === c.key} disabled={busy} onClick={() => setChain(c.key)}><span className="dot" />{chainName(c.key)}</button>
                ))}</span>
              ) : null}
            </div>
            <div className="amount">
              <input inputMode="decimal" aria-label={`Amount of ${from}`} value={amount} disabled={busy}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').replace(/(\.\d{0,2}).*$/, '$1'))} />
              <span className="unit">{from}</span>
            </div>
          </div>
          <div className="swapdir"><button type="button" aria-label="Flip direction" disabled={busy} onClick={() => setDirection(direction === 'in' ? 'out' : 'in')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 2v10M4 12l-2.5-2.5M4 12l2.5-2.5M10 12V2M10 2L7.5 4.5M10 2l2.5 2.5" /></svg>
          </button></div>
          <div className="leg">
            <div className="leg-top">
              <span className="label">You receive · {toChain}</span>
              {direction === 'out' ? (
                <span className="chainpick">{chains.map((c) => (
                  <button key={c.key} type="button" className="chip" aria-pressed={activeChain === c.key} disabled={busy} onClick={() => setChain(c.key)}><span className="dot" />{chainName(c.key)}</button>
                ))}</span>
              ) : null}
            </div>
            <div className="amount"><span className="big">{cents > fee ? ((cents - fee) / 100).toFixed(2) : '0.00'}</span><span className="unit">{to}</span></div>
          </div>

          <div className="rows">
            <div><span>Fee (0.3%, min 1¢)</span><b>${(fee / 100).toFixed(2)}</b></div>
            <div><span>Gas on {chainName(activeChain)}</span><b>paid by the relayer</b></div>
            <div><span>Speed</span><b>{cents <= (info?.instantTierMax ?? 500) ? 'seconds (0-conf, capped)' : 'after one BCH confirmation'}</b></div>
            <div><span>If anything stalls</span><b>your {from} refunds after 4 h</b></div>
          </div>

          <div className="wallets">
            <BchWalletRow bch={bch} onConnect={() => setShowQr(true)} />
            <EvmWalletRow chainId={chainIdOf(activeChain)} devAddress={devAccount?.address} />
          </div>

          {pending ? (
            <div className="leg" style={{ background: 'var(--bone2)' }}>
              <div className="label">Quote from {info?.name}</div>
              <div className="rows">
                <div><span>You send</span><b>{(pending.amountIn / 100).toFixed(2)} {from}</b></div>
                <div><span>You receive</span><b>{(pending.amountOut / 100).toFixed(2)} {to}</b></div>
                <div><span>Tier</span><b>{pending.tier}</b></div>
              </div>
              <div className="ctas" style={{ marginTop: 14 }}>
                <button className="btn ink" type="button" onClick={() => answer(true)}>Confirm and sign</button>
                <button className="btn ghost" type="button" onClick={() => answer(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn ink wide" style={{ marginTop: 16 }} type="button" disabled={!canStart}
              onClick={() => void runner.start(direction, activeChain, cents)}>
              {busy ? 'Swapping…' : `Swap ${from} → ${to}`}
            </button>
          )}
          {blocker && !busy ? <div className="notice info">{blocker}</div> : null}
          {needsBch && direction === 'in' && !bch.wallet ? null : null}
        </div>

        <SwapProgress swap={runner.swap} stage={runner.stage} error={runner.error} note={runner.note} started={runner.started} fundsAt={runner.fundsAt} plan={direction} />
      </div>
      {showQr && bch.wc.state !== 'connected' ? <WizardDialog bch={bch} onClose={() => setShowQr(false)} /> : null}
    </Page>
  );
}
