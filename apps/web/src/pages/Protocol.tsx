import { Page } from '../components/Shell';
import { CONFIG } from '../lib/config';

const rows: Array<[string, string]> = [
  ['Solver never locks', "Your lock refunds after its timeout. On Bitcoin Cash anyone can execute the refund (it needs no key); the solver's watchtower does it for you."],
  ['You never reveal', "The solver's lock refunds after its shorter timeout, then yours."],
  ['The relayer stalls', "The browser watches the escrow itself after revealing and claims with your own wallet if the relayer has not within 30 s."],
  ['A solver lies about its lock', 'Your browser checks the lock on-chain against what it asked for (your address, the quoted amount, your hash, a safe timeout) and keeps the secret if anything differs.'],
  ['Dust or junk at a lock address', 'Ignored: only the expected outpoint, token and amount count.'],
  ['The solver crashes mid-swap', 'Second-leg parameters are persisted before the first send and re-sent byte for byte; an identical EVM lock id cannot be opened twice.'],
];

export function Protocol() {
  return (
    <Page>
      <div className="page-h">
        <h1>Protocol</h1>
        <p>Two locks, one 32-byte secret. Nothing bridged, nothing wrapped. Full spec, timeouts and threat model in <a href={`${CONFIG.repoUrl}/blob/main/docs/PROTOCOL.md`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>docs/PROTOCOL.md</a>.</p>
      </div>
      <div className="compare">
        <div className="tile">
          <div className="n">Bitcoin Cash</div>
          <h3>ChirographLock</h3>
          <p>72-byte CashScript 0.14 covenant (P2SH32). <code>claim(secret)</code>: 32 bytes and <code>sha256(secret) == secretHash</code>. <code>refund()</code>: after <code>refundTime</code> (median time past). Both paths share one payout rule, compiled into <code>OP_DEFINE</code>/<code>OP_INVOKE</code> from the May 2026 upgrade: the output at the input's own index must pay the fixed destination, keep the token category, amount and NFT commitment, and lose at most 1,000 sats of fee. No signature anywhere: anyone can execute, nobody can redirect.</p>
        </div>
        <div className="tile">
          <div className="n">Base · Arbitrum</div>
          <h3>ChirographHTLC</h3>
          <p>Ownerless USDC escrow. Users lock with an EIP-3009 <code>ReceiveWithAuthorization</code> whose nonce is the lock id, so the signature pins every parameter and the relayer, which pays the gas, can delay a lock but never change it. <code>claim(id, secret)</code> pays the recipient, <code>refund(id)</code> returns funds after the timeout; anyone may call either. The same <code>sha256</code> runs on both chains.</p>
        </div>
      </div>
      <div className="sec" style={{ borderTop: 0, padding: '48px 0 0' }}>
        <div className="sec-h"><h2 style={{ fontSize: 'clamp(32px,4vw,52px)' }}>Timeouts</h2><p>The side that holds the secret locks first and gets the longer timeout, so the other side always has time to reuse a revealed secret.</p></div>
        <div className="card card-pad">
          <div className="rows">
            <div><span>USDC → PUSD</span><b>your USDC: 4 h · solver PUSD: 1 h</b></div>
            <div><span>PUSD → USDC</span><b>your PUSD: 4 h · solver USDC: 1 h</b></div>
            <div><span>Browser reveals only if</span><b>solver lock has ≥ 45 min left and expires ≥ 1 h before yours</b></div>
            <div><span>0-conf fills</span><b>P2PKH-only inputs · 4 s double-spend-proof window · capped per swap and in total</b></div>
          </div>
          <p className="d" style={{ color: 'var(--muted)', fontSize: 13.5, marginBottom: 0 }}>Bitcoin Cash checks time locks against median time past, which trails the wall clock by up to an hour on 10-minute blocks, so BCH refunds open later than their nominal time. One-minute blocks (locked in on 15 November 2026, active May 2027) shrink that lag to minutes.</p>
        </div>
      </div>
      <div className="sec" style={{ borderTop: 0, padding: '48px 0 0' }}>
        <div className="sec-h"><h2 style={{ fontSize: 'clamp(32px,4vw,52px)' }}>When things go wrong</h2><p>Every failure ends in a refund or a completed swap. None ends with one side holding both.</p></div>
        <div className="card">
          <ol className="tl" style={{ padding: '6px 22px' }}>
            {rows.map(([t, d]) => <li key={t} className="done"><span className="m" /><div><div className="t">{t}</div><div className="d">{d}</div></div><div /></li>)}
          </ol>
        </div>
      </div>
      <div className="sec" style={{ borderTop: 0, padding: '48px 0 0' }}>
        <div className="sec-h"><h2 style={{ fontSize: 'clamp(32px,4vw,52px)' }}>What we do not claim</h2><p>Stated plainly, so you can trust the rest.</p></div>
        <div className="verbs" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="tile"><div className="n">Liquidity</div><h3>One solver, a few dollars</h3><p>The reference solver holds a few dollars on purpose. The quote API is open so anyone can run another; nobody else does yet.</p></div>
          <div className="tile"><div className="n">0-conf</div><h3>A priced risk</h3><p>Fast fills accept unconfirmed BCH under strict rules and caps. Above the cap, the swap waits for a confirmation.</p></div>
          <div className="tile"><div className="n">Free option</div><h3>Bounded, not zero</h3><p>A user can sign and then wait to reveal. On a stablecoin pair it is worth little, and the solver's timeout bounds it to an hour.</p></div>
        </div>
      </div>
    </Page>
  );
}
