import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi';
import { privateKeyToAccount } from 'viem/accounts';
import { isAddress, type Address, type Hex } from 'viem';
import { addressToBytecode } from '@chirograph/sdk';
import { CONFIG, TRUST } from '../lib/config';
import type { Direction, EvmChainKey, Quote, StableSymbol } from '@chirograph/sdk';
import { Page } from '../components/Shell';
import { BchWalletRow, EvmWalletRow, WizardDialog } from '../components/Wallets';
import { SwapProgress } from '../components/SwapProgress';
import { useBch, useSolverInfo, useSwapRunner } from '../lib/hooks';
import { FEE } from '../lib/facts';
import { chainIdOf, chainName } from '../lib/chains';

// Development-only local signer (never present in production builds).
const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_EVM_KEY as Hex | undefined) : undefined;
const devAccount = devKey ? privateKeyToAccount(devKey) : undefined;

const bchPrefix = CONFIG.bchNetwork === 'mainnet' ? 'bitcoincash:' : 'bchtest:';
/** A pasted Bitcoin Cash address we can pay a covenant output to, or null. */
function validBch(a: string): string | null {
  const v = a.trim();
  if (!v.toLowerCase().startsWith(bchPrefix)) return null;
  try { addressToBytecode(v); return v; } catch { return null; }
}

export function Swap({ id }: { id?: string }) {
  const { info, error: solverError } = useSolverInfo(10_000);
  const bch = useBch(info?.pusdCategory);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const connectedEvm = (devAccount?.address ?? address) as Address | undefined;
  // The receiving side can be a pasted address instead of a second connected wallet:
  // USDC -> PUSD only needs a Bitcoin Cash address to pay, PUSD -> USDC only an EVM address.
  const [pasteBch, setPasteBch] = useState('');
  const [pasteEvm, setPasteEvm] = useState('');

  const [direction, setDirection] = useState<Direction>('in');
  const [token, setToken] = useState<StableSymbol>('PUSD');
  const [chain, setChain] = useState<EvmChainKey | null>(null);
  const [amount, setAmount] = useState('1.00');
  const [showQr, setShowQr] = useState(false);
  const [pending, setPending] = useState<Quote | null>(null);
  const pastedBch = direction === 'in' && !bch.wallet ? validBch(pasteBch) : null;
  const pastedEvm = direction === 'out' && !connectedEvm && isAddress(pasteEvm.trim()) ? (pasteEvm.trim() as Address) : undefined;
  const evmAddress = connectedEvm ?? pastedEvm;
  const decide = useRef<((ok: boolean) => void) | null>(null);

  const chains = info?.chains ?? [];
  const activeChain = (chain ?? chains[0]?.key ?? 'base') as EvmChainKey;
  const cents = Math.round(Number(amount) * 100);
  const fee = Math.max(FEE.minCents, Math.ceil((cents * FEE.bps) / 10_000));
  const offered = (info?.tokens?.map((t) => t.symbol) ?? ['PUSD']) as StableSymbol[];
  // A token the solver stopped offering (e.g. from an old swap link) falls back to PUSD.
  useEffect(() => { if (info && !offered.includes(token)) setToken('PUSD'); }, [info, offered.join(), token]); // eslint-disable-line react-hooks/exhaustive-deps
  const capRow = info?.capacity[activeChain];
  const cap = direction === 'in' ? capRow?.inBy?.[token] ?? (token === 'PUSD' ? capRow?.in ?? 0 : 0) : capRow?.out ?? 0;
  const held = bch.wallet ? bch.wallet.tokensBy[TRUST.tokens[token]] ?? 0n : 0n;

  const deps = useMemo(() => ({
    info, bch, evmAddress, bchTarget: pastedBch ?? undefined,
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
  }), [info, bch, evmAddress, pastedBch, signTypedDataAsync, switchChainAsync, writeContractAsync]);
  const runner = useSwapRunner(deps as never, id ?? null);
  // Opening a swap by link: show its own direction, chain and amount in the form.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const s = runner.swap;
    if (!id || !s || shown.current === s.id) return;
    shown.current = s.id;
    setDirection(s.direction);
    setChain(s.chain as EvmChainKey);
    setToken(s.token ?? 'PUSD');
    setAmount((s.amountIn / 100).toFixed(2));
  }, [id, runner.swap]);
  // A finished swap changed the wallet's balances: re-read them so the next swap sees the new amounts.
  const swapStatus = runner.swap?.status;
  useEffect(() => { if (swapStatus === 'completed' || swapStatus === 'refunded') void bch.refresh(); }, [swapStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = useCallback((ok: boolean) => { decide.current?.(ok); decide.current = null; setPending(null); }, []);

  const busy = runner.stage === 'signing' || runner.stage === 'waiting_solver' || runner.stage === 'claiming';
  const haveBch = direction === 'in' ? !!(bch.wallet || pastedBch) : !!bch.wallet;
  const haveEvm = direction === 'in' ? !!connectedEvm : !!evmAddress;
  const canStart = !!info && haveBch && haveEvm && cents >= 25 && cents <= cap && !busy
    && (direction === 'in' || held >= BigInt(cents));
  const blocker = !info ? (solverError ? 'Solver unreachable right now.' : 'Connecting to the solver…')
    : !haveBch ? (direction === 'in' ? `Connect a Bitcoin Cash wallet, or paste the address that should receive ${token}.` : `Connect the Bitcoin Cash wallet that holds your ${token}.`)
      : !haveEvm ? (direction === 'in' ? 'Connect the EVM wallet that holds your USDC.' : 'Connect an EVM wallet, or paste the address that should receive USDC.')
        : cents < 25 ? 'The smallest swap is $0.25.'
          : cents > cap ? `The solver can fill up to $${(cap / 100).toFixed(2)} in this direction right now.`
            : direction === 'out' && held < BigInt(cents) ? `Not enough ${token} in this wallet.` : null;

  const from = direction === 'in' ? 'USDC' : token;
  const to = direction === 'in' ? token : 'USDC';
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
            <button type="button" aria-pressed={direction === 'in'} disabled={busy} onClick={() => setDirection('in')}>USDC → {token}</button>
            <button type="button" aria-pressed={direction === 'out'} disabled={busy} onClick={() => setDirection('out')}>{token} → USDC</button>
          </div>

          <div className="leg">
            <div className="leg-top">
              <span className="label">You send · {fromChain}</span>
              {direction === 'out' ? (offered.length > 1 ? (
                <span className="chainpick" role="group" aria-label="Bitcoin Cash dollar">{offered.map((t) => (
                  <button key={t} type="button" className="chip" aria-pressed={token === t} disabled={busy} onClick={() => setToken(t)}><span className="dot" />{t}</button>
                ))}</span>
              ) : null) : null}
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
              {direction === 'in' ? (offered.length > 1 ? (
                <span className="chainpick" role="group" aria-label="Bitcoin Cash dollar">{offered.map((t) => (
                  <button key={t} type="button" className="chip" aria-pressed={token === t} disabled={busy} onClick={() => setToken(t)}><span className="dot" />{t}</button>
                ))}</span>
              ) : null) : null}
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
            {direction === 'in' && !bch.wallet ? (
              <input className="paste" spellCheck={false} placeholder={`or paste a ${bchPrefix}… address to receive ${token}`} aria-label={`Bitcoin Cash address to receive ${token}`}
                value={pasteBch} disabled={busy} onChange={(e) => setPasteBch(e.target.value)} aria-invalid={!!pasteBch && !pastedBch} />
            ) : null}
            <EvmWalletRow chainId={chainIdOf(activeChain)} devAddress={devAccount?.address} />
            {direction === 'out' && !connectedEvm ? (
              <input className="paste" spellCheck={false} placeholder="or paste a 0x… address to receive USDC" aria-label="EVM address to receive USDC"
                value={pasteEvm} disabled={busy} onChange={(e) => setPasteEvm(e.target.value)} aria-invalid={!!pasteEvm && !pastedEvm} />
            ) : null}
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
              onClick={() => void runner.start(direction, activeChain, cents, token)}>
              {busy ? 'Swapping…' : `Swap ${from} → ${to}`}
            </button>
          )}
          {blocker && !busy ? <div className="notice info">{blocker}</div> : null}
        </div>

        <SwapProgress swap={runner.swap} stage={runner.stage} error={runner.error} note={runner.note} started={runner.started} fundsAt={runner.fundsAt} plan={direction} planAmount={cents} planToken={token} />
      </div>
      {showQr && bch.wc.state !== 'connected' ? <WizardDialog bch={bch} onClose={() => setShowQr(false)} /> : null}
    </Page>
  );
}
