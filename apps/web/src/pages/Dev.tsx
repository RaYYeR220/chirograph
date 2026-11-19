import { useMemo, useState } from 'react';
import { useAccount, useConnect, useSignTypedData } from 'wagmi';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { Direction, EvmChainKey } from '@chirograph/sdk';
import { useBch, useSolverInfo, useSwapRunner } from '../lib/hooks';

// Development-only local signer (never present in production builds).
const devKey = import.meta.env.DEV ? (import.meta.env.VITE_DEV_EVM_KEY as Hex | undefined) : undefined;
const devAccount = devKey ? privateKeyToAccount(devKey) : undefined;

export function Dev() {
  const { info, error } = useSolverInfo(5_000);
  const bch = useBch(info?.pusdCategory);
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { signTypedDataAsync } = useSignTypedData();
  const evmAddress = devAccount?.address ?? address;
  const deps = useMemo(() => ({
    info, bch, evmAddress,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signTypedData: (typed: any) => (devAccount ? devAccount.signTypedData(typed) : signTypedDataAsync(typed)),
  }), [info, bch, evmAddress, signTypedDataAsync]);
  const runner = useSwapRunner(deps, null);
  const [amount, setAmount] = useState(100);
  const chain = (info?.chains[0]?.key ?? 'base') as EvmChainKey;

  const go = (d: Direction) => void runner.start(d, chain, amount);

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: 24, maxWidth: 900 }}>
      <h1>Chirograph · dev harness</h1>
      <p data-testid="solver">{error ? `solver error: ${error}` : info ? `${info.name} · capacity ${JSON.stringify(info.capacity)}` : 'loading…'}</p>
      <section>
        <h2>Bitcoin Cash</h2>
        <p data-testid="bch-state">{bch.wc.state}{bch.wc.walletName ? ` · ${bch.wc.walletName}` : ''}</p>
        {bch.wc.state === 'idle' || bch.wc.state === 'disconnected'
          ? <button data-testid="bch-connect" onClick={() => bch.wc.connect()}>Connect BCH wallet</button>
          : null}
        {bch.wc.uri && bch.wc.state === 'connecting' ? <p>URI: <code data-testid="wiz-uri">{bch.wc.uri}</code></p> : null}
        {bch.wallet ? (
          <p data-testid="bch-wallet">{bch.wallet.receive.tokenAddress} · {String(bch.wallet.sats)} sats · {String(bch.wallet.tokens)} token units</p>
        ) : null}
      </section>
      <section>
        <h2>EVM</h2>
        <p data-testid="evm">{evmAddress ?? 'not connected'}{devAccount ? ' (dev signer)' : ''}</p>
        {!evmAddress ? connectors.map((c) => <button key={c.uid} onClick={() => connect({ connector: c })}>{c.name}</button>) : null}
      </section>
      <section>
        <h2>Swap</h2>
        <input data-testid="amount" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /> cents
        <button data-testid="go-in" onClick={() => go('in')}>USDC → PUSD</button>
        <button data-testid="go-out" onClick={() => go('out')}>PUSD → USDC</button>
        <p data-testid="stage">{runner.stage}{runner.error ? ` · ${runner.error}` : ''}</p>
        <p data-testid="status">{runner.swap?.status ?? '-'}</p>
        <ol>{runner.swap?.timeline.map((e, i) => <li key={i}>{e.event}{e.txid ? ` (${e.txid.slice(0, 12)}…)` : ''}{e.note ? ` – ${e.note}` : ''}</li>)}</ol>
      </section>
    </main>
  );
}
