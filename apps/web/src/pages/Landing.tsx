import { useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { Banner, Footer, Nav } from '../components/Shell';
import { startSeamField, type SeamFieldHandle } from '../components/seamField';
import { useSolverInfo } from '../lib/hooks';
import { BASELINE, MEASURED } from '../lib/facts';
import { CONFIG } from '../lib/config';

export function Landing() {
  const cv = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const steps = useRef<HTMLOListElement>(null);
  const watch = useRef<HTMLButtonElement>(null);
  const { info } = useSolverInfo(20_000);

  useEffect(() => {
    let handle: SeamFieldHandle | undefined;
    let cancelled = false;
    if (cv.current && panel.current && steps.current) {
      void startSeamField(cv.current, panel.current, steps.current, watch.current ?? undefined).then((h) => {
        if (cancelled) h.destroy(); else handle = h;
      });
    }
    return () => { cancelled = true; handle?.destroy(); };
  }, []);

  const cap = info ? Math.max(...Object.values(info.capacity).flatMap((c) => [c.in, c.out])) : null;
  const snippet = `<script src="${location.origin}/pay.js"\n  data-to="bitcoincash:z…your-address"\n  data-amount="2.50"></script>`;

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <Banner />
      <div className="top">
        <canvas className="field" ref={cv} role="img" aria-label="A field split by a wavy seam drawn from the SHA-256 of a fresh 32-byte secret. Squares on the left are USDC on Base or Arbitrum, circles on the right are PUSD on Bitcoin Cash. A swap locks a ring on each side, one secret crosses the seam, and both rings open to their new owners. Every fourth swap the secret never arrives and both sides refund. Click to start a swap at that height." />
        <Nav />
        <section className="hero">
          <div className="panel rv d1" ref={panel}>
            <h1>One secret<br />opens both.</h1>
            <p className="sub">USDC on Base or Arbitrum. PUSD or MUSD on Bitcoin Cash. Both sides lock to the same 32-byte secret, and only the secret crosses. If anything stalls, both sides refund themselves.</p>
            <div className="ctas">
              <Link className="btn ink" href="/swap">Swap USDC ↔ PUSD</Link>
              <button className="btn ghost" ref={watch} type="button">Watch a swap</button>
            </div>
            <p className="proof">Live on <i>Base</i> · <i>Arbitrum</i> · <i>Bitcoin Cash</i>{cap !== null ? <> · solver can fill <i>${(cap / 100).toFixed(2)}</i> right now</> : null}</p>
          </div>
        </section>
        <div className="steps rv d2" aria-hidden="true">
          <div className="pill">
            <ol ref={steps}>
              <li><span>01</span>Secret</li><li><span>02</span>Lock on Base</li><li><span>03</span>Lock on Bitcoin Cash</li>
              <li><span>04</span><em className="l4" style={{ fontStyle: 'normal' }}>Secret crosses</em></li>
              <li><span>05</span><em className="l5" style={{ fontStyle: 'normal' }}>Both open</em></li>
            </ol>
            <span className="hint">click the field to start a swap there</span>
          </div>
        </div>
      </div>

      <section className="sec" id="how">
        <div className="wrap">
          <div className="sec-h">
            <h2>Four moves.<br />One crossing.</h2>
            <p>USDC stays on its chain, PUSD stays on Bitcoin Cash. The 32-byte secret your browser draws is the only thing that crosses.</p>
          </div>
          <ol className="verbs">
            <li className="tile"><div className="n">01</div><h3>Sign</h3><p>One EIP-3009 authorization. The relayer locks your USDC under <code>SHA-256(secret)</code> and pays the gas. Refunds to you after 4 h.</p></li>
            <li className="tile"><div className="n">02</div><h3>Lock</h3><p>A solver locks PUSD to you on Bitcoin Cash under the same hash, in a 72-byte covenant anyone can execute and nobody can redirect.</p></li>
            <li className="tile"><div className="n">03</div><h3>Reveal</h3><p>Your browser checks that lock on-chain, then claims the PUSD with no key. The claim is what makes the secret public.</p></li>
            <li className="tile"><div className="n">04</div><h3>Settle</h3><p>The solver reuses the secret to collect the USDC. If anything stalls, both sides refund themselves after their timeouts.</p></li>
          </ol>
        </div>
      </section>

      <section className="sec" id="numbers">
        <div className="wrap">
          <div className="sec-h">
            <h2>Seconds,<br />not a block.</h2>
            <p>The same $2 through today's route (THORChain to BCH, then a second swap to PUSD) versus one Chirograph swap.</p>
          </div>
          <div className="compare">
            <div className="metric">
              <div className="k">USDC → PUSD, signature to spendable PUSD</div>
              <div className="v">{MEASURED.inSeconds.toFixed(1)} s <small>one signature · 0.3%</small></div>
              <div className="vs">via THORChain + Cauldron: <b>~{BASELINE.inSeconds} s + a second swap</b>, {BASELINE.inSignatures} signatures, ~{BASELINE.inFeePct}% in fees</div>
            </div>
            <div className="metric">
              <div className="k">PUSD → USDC, signature to USDC in your wallet</div>
              <div className="v">{MEASURED.outSeconds.toFixed(1)} s <small>one signature · 0.3%</small></div>
              <div className="vs">via Cauldron + THORChain: <b>~{Math.round(BASELINE.outSeconds / 60)} min</b> (waits for a BCH block), ~{BASELINE.outFeePct}% in fees</div>
            </div>
          </div>
          <p className="foot-note">Chirograph: {MEASURED.source} (<a href={`${CONFIG.repoUrl}/blob/main/PROOF.md`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>every transaction</a>). Baseline: {BASELINE.source}. Fast settlement uses 0-conf with double-spend proofs and is capped per swap; see the <Link href="/protocol" style={{ textDecoration: 'underline' }}>protocol</Link>.</p>
        </div>
      </section>

      <section className="sec" id="merchants">
        <div className="wrap">
          <div className="sec-h">
            <h2>Take USDC.<br />Get PUSD.</h2>
            <p>One script tag on any Bitcoin Cash shop. Your customer signs once with any USDC wallet on Base or Arbitrum; PUSD (or MUSD) lands at your address seconds later.</p>
          </div>
          <div className="compare">
            <pre className="tile" style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 13, overflowX: 'auto', whiteSpace: 'pre' }}>{snippet}</pre>
            <div className="tile">
              <div className="n">For merchants</div>
              <h3>No bridge account, no custody</h3>
              <p>The payer's browser holds the secret and claims the PUSD straight to your address; nobody, including us, can redirect it. <Link href="/merchants" style={{ textDecoration: 'underline' }}>Try the checkout →</Link></p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="proof">
        <div className="wrap">
          <div className="sec-h">
            <h2>Check it<br />yourself.</h2>
            <p>Every swap is public, every lock is on-chain, and the code is open.</p>
          </div>
          <div className="verbs">
            <Link className="tile" href="/explorer"><div className="n">Live</div><h3>Every swap</h3><p>Both chains' transactions for every swap, as they happen.</p></Link>
            <Link className="tile" href="/protocol"><div className="n">Spec</div><h3>Threat model</h3><p>Timeouts, 0-conf limits, failure modes and what we do not claim.</p></Link>
            <a className="tile" href={CONFIG.repoUrl} target="_blank" rel="noreferrer"><div className="n">Code</div><h3>Contracts</h3><p>72-byte CashScript covenant, USDC escrow, solver, this app. MIT.</p></a>
            <Link className="tile" href="/swap"><div className="n">Try</div><h3>Swap $1</h3><p>Connect Selene, Paytaca or Cashonize and any EVM wallet.</p></Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
