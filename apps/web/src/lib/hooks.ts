import { useCallback, useEffect, useRef, useState } from 'react';
import { useWizardConnect } from '@wizardconnect/react';
import type { Address, Hex } from 'viem';
import type { Direction, EvmChainKey, Quote, SolverInfo, SwapRecord } from '@chirograph/sdk';
import { scanWallet, type WalletSnapshot } from './bchWallet';
import { claimSwapIn, revealSwapOut, solver, startSwapIn, startSwapOut, storedSwap, storedSwaps } from './swaps';

export function useSolverInfo(pollMs = 15_000) {
  const [info, setInfo] = useState<SolverInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => solver.info().then((i) => { if (alive) { setInfo(i); setError(null); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    load();
    const t = setInterval(load, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [pollMs]);
  return { info, error };
}

/** WizardConnect session plus a scanned view of the wallet's balances. */
export function useBch(category: string | undefined) {
  const wc = useWizardConnect({
    dappName: 'Chirograph',
    dappIcon: `${location.origin}/icon.png`,
    sessionKey: 'chirograph-wizardconnect',
    relayUrls: ['wss://relay.riften.net', 'wss://relay.cauldron.quest'],
  });
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [scanning, setScanning] = useState(false);
  const refresh = useCallback(async () => {
    if (!wc.manager || wc.state !== 'connected' || !category) return;
    setScanning(true);
    try { setWallet(await scanWallet(wc.manager, category)); } finally { setScanning(false); }
  }, [wc.manager, wc.state, category]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (wc.state !== 'connected') setWallet(null); }, [wc.state]);
  return { wc, wallet, scanning, refresh };
}

/** Live view of one swap over server-sent events, with a polling fallback. */
export function useSwapRecord(id: string | null) {
  const [swap, setSwap] = useState<SwapRecord | null>(null);
  useEffect(() => {
    if (!id) { setSwap(null); return; }
    let alive = true;
    solver.swap(id).then((s) => alive && setSwap(s)).catch(() => undefined);
    const close = solver.events(id, (s) => alive && setSwap(s));
    const poll = setInterval(() => solver.swap(id).then((s) => alive && setSwap(s)).catch(() => undefined), 5_000);
    return () => { alive = false; close(); clearInterval(poll); };
  }, [id]);
  return swap;
}

export type RunnerStage = 'idle' | 'signing' | 'waiting_solver' | 'claiming' | 'done' | 'refunding' | 'error';

/**
 * Drives one swap from the user's side: start it (one signature), then act automatically when the
 * solver's lock lands: claim PUSD keylessly (USDC -> PUSD) or verify and reveal (PUSD -> USDC).
 */
export function useSwapRunner(deps: {
  info: SolverInfo | null;
  bch: ReturnType<typeof useBch>;
  evmAddress?: Address;
  signTypedData: (typed: Parameters<Parameters<typeof startSwapIn>[0]['signTypedData']>[0]) => Promise<Hex>;
}) {
  const [id, setId] = useState<string | null>(() => storedSwaps()[0]?.id ?? null);
  const [stage, setStage] = useState<RunnerStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const swap = useSwapRecord(id);
  const acting = useRef(false);
  /** Swaps whose claim/reveal already succeeded in this tab: never act twice. */
  const handled = useRef(new Set<string>());

  const start = useCallback(async (direction: Direction, chain: EvmChainKey, amount: number) => {
    const { info, bch, evmAddress } = deps;
    if (!info || !evmAddress) throw new Error('connect both wallets first');
    setError(null);
    setId(null);
    setStage('signing');
    setStarted(Date.now());
    try {
      const quote: Quote = await solver.quote({ direction, chain, amount });
      if (direction === 'in') {
        const target = bch.wallet?.receive.tokenAddress;
        if (!target) throw new Error('connect a Bitcoin Cash wallet to receive PUSD');
        const s = await startSwapIn({ info, quote, userEvm: evmAddress, bchTokenAddress: target, signTypedData: deps.signTypedData });
        setId(s.id);
      } else {
        if (!bch.wc.manager || !bch.wallet) throw new Error('connect a Bitcoin Cash wallet holding PUSD');
        const s = await startSwapOut({ info, quote, manager: bch.wc.manager, wallet: bch.wallet, userEvm: evmAddress });
        setId(s.id);
      }
      setStage('waiting_solver');
    } catch (e) {
      setStage('error');
      setError((e as Error).message);
    }
  }, [deps]);

  // React to the solver's lock: this is the moment the user's browser acts on its own.
  useEffect(() => {
    if (!swap || acting.current) return;
    const { info, bch, evmAddress } = deps;
    if (swap.status === 'completed') { setStage('done'); setError(null); return; }
    if (swap.status === 'refunding' || swap.status === 'refunded') { setStage('refunding'); return; }
    if (swap.status !== 'solver_locked' || handled.current.has(swap.id)) return;
    // Targets come from this browser's own record of the swap, never from the solver's copy.
    const local = storedSwap(swap.id);
    if (!local || !info) return;
    acting.current = true;
    setStage('claiming');
    void bch; void evmAddress;
    const run = local.direction === 'in'
      ? claimSwapIn(swap)
      : revealSwapOut(swap, info);
    run
      .then(() => { handled.current.add(swap.id); })
      .catch((e: Error) => { setStage('error'); setError(e.message); })
      .finally(() => { acting.current = false; });
  }, [swap, deps]);

  const reset = useCallback(() => { setId(null); setStage('idle'); setError(null); setStarted(null); }, []);
  return { id, swap, stage, error, start, reset, started };
}
