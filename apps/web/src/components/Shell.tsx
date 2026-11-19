import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import QRCode from 'qrcode';
import { CONFIG } from '../lib/config';

export function Mark() {
  return (
    <svg viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 7c1.6-4.2 3.4-4.2 5 0s3.2 4.6 4.6 0 3.4-3.2 4.8 0 3.2 3.8 6.6-1.6" />
    </svg>
  );
}

/** The BCH BLAZE banner: deck, code and the CashTokens address for community-choice votes. */
export function Banner() {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const timer = useRef<number>();
  const addr = CONFIG.emberAddress;
  const shortAddr = addr ? `${addr.slice(0, 13)}…${addr.slice(-4)}` : 'address soon';
  useEffect(() => {
    if (addr) QRCode.toDataURL(addr, { margin: 1, width: 264, color: { dark: '#140c08', light: '#ffffff' } }).then(setQr).catch(() => setQr(null));
  }, [addr]);
  const copy = async () => {
    if (!addr) return;
    try { await navigator.clipboard.writeText(addr); } catch { /* clipboard blocked: the popover still shows it */ }
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 6000);
  };
  return (
    <div className="blaze" role="region" aria-label="BCH BLAZE 2026">
      <div className="wrap">
        <span>BCH BLAZE 2026 entry</span>
        <span className="blaze-r">
          <a href={CONFIG.deckUrl} target="_blank" rel="noreferrer">Deck ↗</a><span className="sep">·</span>
          <a href={CONFIG.repoUrl} target="_blank" rel="noreferrer">Code ↗</a><span className="sep">·</span>
          <button className="vote" type="button" onClick={copy} aria-label="Copy the CashTokens address for EMBER2026 votes">
            <span className="lg">Vote with EMBER2026</span><span className="sm">Vote</span>
            <code>{shortAddr}</code>
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><path d="M8.5 3.5V2.2c0-.4-.3-.7-.7-.7H2.2c-.4 0-.7.3-.7.7v5.6c0 .4.3.7.7.7h1.3" /></svg>
          </button>
        </span>
      </div>
      <div className={`pop${open ? ' on' : ''}`} role="status" aria-live="polite">
        <b>Copied: send EMBER2026 here to vote</b>
        <code>{addr}</code>
        {qr ? <img src={qr} alt="QR code of the voting address" /> : null}
      </div>
    </div>
  );
}

export function Nav() {
  const [loc] = useLocation();
  const item = (href: string, label: string) => (
    <Link href={href} aria-current={loc === href ? 'page' : undefined}>{label}</Link>
  );
  return (
    <header className="nav">
      <div className="wrap">
        <Link className="brand" href="/"><Mark />Chirograph</Link>
        <nav className="links" aria-label="Main">
          {item('/swap', 'Swap')}
          {item('/explorer', 'Explorer')}
          {item('/merchants', 'Pay with USDC')}
          {item('/protocol', 'Protocol')}
          <Link className="btn sm ink" href="/swap">Open app</Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="wrap">
        <span>Chirograph · USDC ↔ PUSD atomic swaps · MIT</span>
        <span>
          <a href={CONFIG.repoUrl} target="_blank" rel="noreferrer">Source</a> ·{' '}
          <Link href="/protocol">Protocol & threat model</Link> ·{' '}
          <Link href="/explorer">Every swap</Link>
        </span>
      </div>
    </footer>
  );
}

/** Inner pages: banner, nav, content, footer on the plain vermilion ground. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <Banner />
      <Nav />
      <main className="page"><div className="wrap">{children}</div></main>
      <Footer />
    </>
  );
}
