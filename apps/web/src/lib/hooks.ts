import { useCallback, useEffect, useRef, useState } from 'react';
import { useWizardConnect } from '@wizardconnect/react';
import type { Address, Hex } from 'viem';
import type { Direction, EvmChainKey, Quote, SolverInfo, StableSymbol, SwapRecord } from '@chirograph/sdk';
import { scanWallet, type WalletSnapshot } from './bchWallet';
import { LockState } from '@chirograph/sdk';
import { checkQuote, claimEvmDirect, claimSwapIn, evmLockState, revealSwapOut, solver, startSwapIn, startSwapOut, storedSwap } from './swaps';

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
  // Balances change under us (a swap lands, the user spends elsewhere): re-read them now and then.
  useEffect(() => {
    if (wc.state !== 'connected') return;
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [wc.state, refresh]);
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

export type RunnerStage = 'idle' | 'signing' | 'waiting_solver' | 'claiming' | 'claim_yourself' | 'done' | 'refunding' | 'error';

/**
 * Drives one swap from the user's side: start it (one signature), then act automatically when the
 * solver's lock lands: claim PUSD keylessly (USDC -> PUSD) or verify and reveal (PUSD -> USDC).
 */
export function useSwapRunner(deps: {
  info: SolverInfo | null;
  bch: ReturnType<typeof useBch>;
  evmAddress?: Address;
  signTypedData: (typed: Parameters<Parameters<typeof startSwapIn>[0]['signTypedData']>[0]) => Promise<Hex>;
  /** Show the quote (amount out, fee) and let the user accept it before anything is signed. */
  confirmQuote?: (quote: Quote) => Promise<boolean>;
  /** Pay PUSD to this address instead of the connected wallet (merchant checkout). */
  bchTarget?: string;
  /** Send the user's own EVM claim if the relayer does not (they pay gas). */
  writeClaim?: Parameters<typeof claimEvmDirect>[2];
}, initialId: string | null = null) {
  const [id, setId] = useState<string | null>(initialId);
  const [stage, setStage] = useState<RunnerStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** When the user's funds actually arrived (claim confirmed by this browser), for the headline timer. */
  const [fundsAt, setFundsAt] = useState<number | null>(null);
  const swap = useSwapRecord(id);
  const acting = useRef(false);
  /** Swaps whose claim/reveal already succeeded in this tab: never act twice. */
  const handled = useRef(new Set<string>());

  const start = useCallback(async (direction: Direction, chain: EvmChainKey, amount: number, token: StableSymbol = 'PUSD') => {
    const { info, bch, evmAddress } = deps;
    if (!info || !evmAddress) throw new Error('connect both wallets first');
    setError(null);
    setId(null);
    setFundsAt(null);
    setStage('signing');
    setStarted(Date.now());
    try {
      const quote: Quote = await solver.quote({ direction, chain, amount, token });
      checkQuote(quote, { direction, chain, amount, token });
      if (deps.confirmQuote && !(await deps.confirmQuote(quote))) { setStage('idle'); return; }
      // Time the swap from the moment the user agreed to the quote, not from the first click.
      setStarted(Date.now());
      if (direction === 'in') {
        const target = deps.bchTarget ?? bch.wallet?.receive.tokenAddress;
        if (!target) throw new Error(`connect a Bitcoin Cash wallet to receive ${token}`);
        const s = await startSwapIn({ info, quote, userEvm: evmAddress, bchTokenAddress: target, signTypedData: deps.signTypedData });
        setId(s.id);
      } else {
        if (!bch.wc.manager || !bch.wallet) throw new Error(`connect a Bitcoin Cash wallet holding ${token}`);
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
      ? claimSwapIn(swap, setNote)
      : revealSwapOut(swap, info).then(() => watchUntilPaid(swap.id));
    run
      .then(() => { handled.current.add(swap.id); if (local.direction === 'in') setFundsAt(Date.now()); })
      .catch((e: Error) => { setStage('error'); setError(e.message); })
      .finally(() => { acting.current = false; });
  }, [swap, deps]);

  /**
   * After the secret leaves this browser we trust only the chain: poll the escrow until our USDC
   * lock is Claimed. If the relayer has not claimed within 30 s, claim it ourselves.
   */
  const watchUntilPaid = useCallback(async (swapId: string) => {
    const { info } = deps;
    if (!info) return;
    const start = Date.now();
    let triedDirect = false;
    for (;;) {
      const local = storedSwap(swapId);
      if (!local?.verifiedLockId) { setStage('claim_yourself'); return; }
      const state = await evmLockState(swapId, info).catch(() => null);
      if (state === LockState.Claimed) { setFundsAt(Date.now()); return; }
      if (state === LockState.Open && !triedDirect && Date.now() - start > 30_000) {
        triedDirect = true;
        if (deps.writeClaim) {
          setNote('the relayer has not claimed yet; claiming with your wallet');
          const s = await solver.swap(swapId).catch(() => null);
          if (s) await claimEvmDirect(s, info, deps.writeClaim).catch((e: Error) => setError(e.message));
        } else {
          setStage('claim_yourself');
          return;
        }
      }
      await new Promise((r) => setTimeout(r, Date.now() - start < 60_000 ? 600 : 3_000));
    }
  }, [deps]);

  const reset = useCallback(() => { setId(null); setStage('idle'); setError(null); setStarted(null); setNote(null); setFundsAt(null); }, []);
  return { id, swap, stage, error, note, start, reset, started, fundsAt };
}
