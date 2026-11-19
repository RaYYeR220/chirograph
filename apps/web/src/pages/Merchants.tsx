import { useEffect, useRef, useState } from 'react';
import { Page } from '../components/Shell';

/** A live demo shop with the real embed script, plus the copy-paste snippet. */
export function Merchants() {
  const slot = useRef<HTMLDivElement>(null);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('1.00');
  const [paid, setPaid] = useState<string | null>(null);
  const valid = /^(bitcoincash|bchtest):[zr][a-z0-9]{40,}$/.test(to) && /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) >= 0.25;

  useEffect(() => {
    const el = slot.current;
    if (!el || !valid) return;
    el.replaceChildren();
    const s = document.createElement('script');
    s.src = '/pay.js';
    s.setAttribute('data-to', to);
    s.setAttribute('data-amount', Number(amount).toFixed(2));
    s.setAttribute('data-label', 'Demo order');
    el.appendChild(s);
    const onPaid = (e: Event) => setPaid(JSON.stringify((e as CustomEvent).detail));
    el.addEventListener('chirograph:paid', onPaid);
    return () => { el.removeEventListener('chirograph:paid', onPaid); el.replaceChildren(); };
  }, [to, amount, valid]);

  const snippet = `<script src="${location.origin}/pay.js"\n        data-to="${to || 'bitcoincash:z…your-token-address'}"\n        data-amount="${amount}"\n        data-label="Order 1042"></script>`;

  return (
    <Page>
      <div className="page-h">
        <h1>Take USDC.<br />Get PUSD.</h1>
        <p>A Bitcoin Cash shop adds one script tag. The customer signs once with any USDC wallet on Base or Arbitrum; the shop's address receives PUSD on Bitcoin Cash. No account with us, no custody, nothing to redirect.</p>
      </div>
      <div className="app-grid">
        <div className="card card-pad">
          <div className="label">Try it with your own address</div>
          <div className="leg">
            <div className="label">Your Bitcoin Cash token address (bitcoincash:z…)</div>
            <input className="mono" style={{ width: '100%', border: 0, background: 'transparent', fontSize: 13, outline: 'none', marginTop: 6 }}
              value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="bitcoincash:z…" aria-label="Merchant address" />
          </div>
          <div className="leg">
            <div className="label">Price (USD)</div>
            <div className="amount"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Price" /><span className="unit">$</span></div>
          </div>
          <div style={{ marginTop: 18, padding: 18, borderRadius: 18, border: '1px dashed var(--line2)' }}>
            <div className="label">Demo order · your shop's checkout</div>
            <div ref={slot} style={{ marginTop: 10, minHeight: 48 }}>{valid ? null : <span style={{ color: 'var(--faint)', fontSize: 14 }}>Enter an address and a price to render the button.</span>}</div>
          </div>
          {paid ? <div className="notice info">Paid: {paid}</div> : null}
        </div>
        <div className="card card-pad">
          <div className="label">Embed</div>
          <pre className="mono" style={{ margin: '10px 0 0', fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{snippet}</pre>
          <ol className="tl" style={{ marginTop: 14 }}>
            <li className="done"><span className="m" /><div><div className="t">The customer clicks Pay</div><div className="d">A checkout opens over your page. They connect any USDC wallet; no Bitcoin Cash wallet needed.</div></div><div /></li>
            <li className="done"><span className="m" /><div><div className="t">One signature</div><div className="d">An EIP-3009 authorization locks their USDC. The relayer pays the gas.</div></div><div /></li>
            <li className="done"><span className="m" /><div><div className="t">PUSD lands at your address</div><div className="d">Their browser claims the solver's PUSD lock straight to your address; nobody can redirect it.</div></div><div /></li>
            <li className="done"><span className="m" /><div><div className="t">Your page is told</div><div className="d">The button fires a <code>chirograph:paid</code> event with the swap id and amount.</div></div><div /></li>
          </ol>
        </div>
      </div>
    </Page>
  );
}
