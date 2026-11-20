import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useSignTypedData, useSwitchChain } from 'wagmi';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import type { EvmChainKey, Quote, StableSymbol } from '@chirograph/sdk';
import { addressToBytecode } from '@chirograph/sdk';
import { Page } from '../components/Shell';
import { EvmWalletRow } from '../components/Wallets';
import { SwapProgress } from '../components/SwapProgress';
import { useBch, useSolverInfo, useSwapRunner } from '../lib/hooks';

const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_EVM_KEY as Hex | undefined) : undefined;
const devAccount = devKey ? privateKeyToAccount(devKey) : undefined;
const chainName = (key: string) => (key.startsWith('arbitrum') ? 'Arbitrum' : 'Base');
const chainIdOf = (key: string) => (key.startsWith('arbitrum') ? 42161 : 8453);

function validTarget(to: string) {
  try { addressToBytecode(to); return /^(bitcoincash|bchtest):[zr]/.test(to); } catch { return false; }
}

/**
 * Checkout for a Bitcoin Cash merchant: the payer only needs a USDC wallet. The payer's browser
 * holds the secret and claims the PUSD straight to the merchant's address, keylessly.
 */
export function Pay() {
  const params = new URLSearchParams(location.search);
  const to = params.get('to') ?? '';
  const label = params.get('label') ?? '';
  const embed = params.get('embed') === '1';
  const cents = Math.round(Number(params.get('amount') ?? '0') * 100);
  // Which Bitcoin Cash dollar the merchant wants: PUSD unless the button asks for MUSD.
  const token: StableSymbol = params.get('token')?.toUpperCase() === 'MUSD' ? 'MUSD' : 'PUSD';
  const ok = validTarget(to) && cents >= 25;

  const { info } = useSolverInfo(15_000);
  const bch = useBch(info?.pusdCategory);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const evmAddress = (devAccount?.address ?? address) as Address | undefined;
  const [chain, setChain] = useState<EvmChainKey | null>(null);
  const activeChain = (chain ?? info?.chains[0]?.key ?? 'base') as EvmChainKey;
  const decide = useRef<((ok: boolean) => void) | null>(null);
  const [pending, setPending] = useState<Quote | null>(null);

  const deps = useMemo(() => ({
    info, bch, evmAddress, bchTarget: to,
    signTypedData: async (typed: Parameters<typeof signTypedDataAsync>[0]) => {
      if (devAccount) return devAccount.signTypedData(typed as never);
      await switchChainAsync({ chainId: Number((typed as { domain: { chainId: number } }).domain.chainId) as 8453 }).catch(() => undefined);
      return signTypedDataAsync(typed);
    },
    // Always an explicit in-frame confirmation that shows the full payee and amount before signing.
    confirmQuote: (q: Quote) => new Promise<boolean>((resolve) => { setPending(q); decide.current = resolve; }),
  }), [info, bch, evmAddress, to, signTypedDataAsync, switchChainAsync]);
  const runner = useSwapRunner(deps as never);
  const answer = (yes: boolean) => { decide.current?.(yes); decide.current = null; setPending(null); };

  // Tell the embedding page when the merchant has been paid.
  useEffect(() => {
    if (embed && runner.swap?.status === 'completed') {
      window.parent?.postMessage({ type: 'chirograph:paid', detail: { swap: runner.swap.id, amount: runner.swap.amountOut, to } }, '*');
    }
  }, [embed, runner.swap?.status, runner.swap?.id, runner.swap?.amountOut, to]);

  const busy = runner.stage === 'signing' || runner.stage === 'waiting_solver' || runner.stage === 'claiming';
  const fee = Math.max(1, Math.ceil((cents * 30) / 10_000));
  const content = (
    <div className="app-grid" style={embed ? { gridTemplateColumns: '1fr' } : undefined}>
      <div className="card card-pad">
        <div className="label">{label ? `Pay · ${label}` : 'Pay a Bitcoin Cash merchant'}</div>
        <div className="amount"><span className="big">${((cents + fee) / 100).toFixed(2)}</span><span className="unit">USDC</span></div>
        <div className="rows">
          <div><span>Merchant receives</span><b>{(cents / 100).toFixed(2)} {token}</b></div>
          <div><span>To</span><b className="mono" style={{ fontSize: 12 }}>{to.slice(0, 18)}…{to.slice(-6)}</b></div>
          <div><span>Network fee</span><b>paid by the relayer</b></div>
        </div>
        <div className="leg-top" style={{ marginTop: 14 }}>
          <span className="label">Pay from</span>
          <span className="chainpick">{info?.chains.map((c) => (
            <button key={c.key} type="button" className="chip" aria-pressed={activeChain === c.key} disabled={busy} onClick={() => setChain(c.key)}><span className="dot" />{chainName(c.key)}</button>
          ))}</span>
        </div>
        <div className="wallets"><EvmWalletRow chainId={chainIdOf(activeChain)} devAddress={devAccount?.address} /></div>
        {pending ? (
          <div className="leg" style={{ background: 'var(--bone2)' }}>
            <div className="label">Confirm this payment</div>
            <div className="rows">
              <div><span>You pay</span><b>{(pending.amountIn / 100).toFixed(2)} USDC on {chainName(activeChain)}</b></div>
              <div><span>Merchant receives</span><b>{(pending.amountOut / 100).toFixed(2)} {pending.token ?? 'PUSD'}</b></div>
            </div>
            <div className="label" style={{ marginTop: 10 }}>Paid to this Bitcoin Cash address, and nowhere else</div>
            <code style={{ display: 'block', fontSize: 12, wordBreak: 'break-all', marginTop: 4 }}>{to}</code>
            <div className="ctas" style={{ marginTop: 14 }}>
              <button className="btn ink" type="button" onClick={() => answer(true)}>Confirm and sign</button>
              <button className="btn ghost" type="button" onClick={() => answer(false)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {!ok ? <div className="notice err">This payment link is incomplete: it needs a Bitcoin Cash token address and an amount of at least $0.25.</div> : (
          <button className="btn ink wide" style={{ marginTop: 16 }} type="button" disabled={!info || !evmAddress || busy}
            onClick={() => void runner.start('in', activeChain, cents + fee, token)}>
            {busy ? 'Paying…' : `Pay $${((cents + fee) / 100).toFixed(2)} with USDC`}
          </button>
        )}
        {embed ? <button className="btn ghost wide sm" style={{ marginTop: 8 }} type="button" onClick={() => window.parent?.postMessage({ type: 'chirograph:close' }, '*')}>Close</button> : null}
      </div>
      <SwapProgress swap={runner.swap} stage={runner.stage} error={runner.error} note={runner.note} started={runner.started} fundsAt={runner.fundsAt} plan="in" planAmount={cents + fee} planToken={token} />
    </div>
  );
  if (embed) return <div style={{ padding: 12 }}>{content}</div>;
  return (
    <Page>
      <div className="page-h"><h1>Checkout</h1><p>Pay any Bitcoin Cash merchant with USDC on Base or Arbitrum. One signature; the merchant receives PUSD or MUSD seconds later.</p></div>
      {content}
    </Page>
  );
}
