import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { AlphanumericQRCode } from '@wizardconnect/react';
import type { Address } from 'viem';
import { erc20Abi } from '@chirograph/sdk';
import type { useBch } from '../lib/hooks';
import { publicClient } from '../lib/evm';
import { TRUST } from '../lib/config';
import { chainNameById } from '../lib/chains';

const short = (s: string, a = 6, b = 4) => (s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
const usd = (cents: bigint | number) => (Number(cents) / 100).toFixed(2);

/** WizardConnect pairing: QR for a phone wallet, a deep link for Selene, a copyable link for Cashonize. */
export function WizardDialog({ bch, onClose }: { bch: ReturnType<typeof useBch>; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { uri, qrUri, state } = bch.wc;
  useEffect(() => { if (state === 'connected') onClose(); }, [state, onClose]);
  if (!uri || !qrUri) return null;
  return (
    <div className="dialog-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-label="Connect a Bitcoin Cash wallet">
        <h3>Connect a Bitcoin Cash wallet</h3>
        <p>Scan with Selene or Paytaca, or paste the link into Cashonize.</p>
        <div className="qr"><AlphanumericQRCode value={qrUri} size={240} foreground="#140c08" background="#ffffff" /></div>
        <div className="row">
          <a className="btn ink sm" style={{ flex: 1 }} href={uri}>Open wallet app</a>
          <button className="btn ghost sm" style={{ flex: 1 }} type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(uri); setCopied(true); } catch { /* ignore */ }
          }}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
        <p style={{ marginTop: 12, fontSize: 12 }}>WizardConnect · end-to-end encrypted over Nostr relays · {state}</p>
      </div>
    </div>
  );
}

export function BchWalletRow({ bch, onConnect }: { bch: ReturnType<typeof useBch>; onConnect: () => void }) {
  const connected = bch.wc.state === 'connected' && bch.wallet;
  return (
    <div className="wallet">
      <div className="who">
        <b>Bitcoin Cash{bch.wc.walletName ? ` · ${bch.wc.walletName}` : ''}</b>
        {connected
          ? <code title={bch.wallet!.receive.tokenAddress}>{short(bch.wallet!.receive.tokenAddress, 18, 6)} · {usd(bch.wallet!.tokensBy[TRUST.tokens.PUSD] ?? 0n)} PUSD · {usd(bch.wallet!.tokensBy[TRUST.tokens.MUSD] ?? 0n)} MUSD</code>
          : <code>{bch.wc.state === 'connected' ? 'reading balances…' : 'Selene · Paytaca · Cashonize'}</code>}
      </div>
      {bch.wc.state === 'connected'
        ? <button className="btn ghost sm" type="button" onClick={() => void bch.wc.disconnect()}>Disconnect</button>
        : <button className="btn ink sm" type="button" onClick={() => { bch.wc.connect(); onConnect(); }}>Connect</button>}
    </div>
  );
}

export function EvmWalletRow({ chainId, devAddress }: { chainId: number; devAddress?: Address }) {
  const { address, connector } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [picking, setPicking] = useState(false);
  const who = devAddress ?? address;
  useEffect(() => {
    let alive = true;
    const pin = TRUST.chains[chainId];
    if (!who || !pin) { setUsdc(null); return; }
    publicClient(chainId).readContract({ address: pin.usdc as Address, abi: erc20Abi, functionName: 'balanceOf', args: [who] })
      .then((b) => { if (alive) setUsdc(b); }).catch(() => { if (alive) setUsdc(null); });
    return () => { alive = false; };
  }, [who, chainId]);
  const chainName = chainNameById(chainId);
  return (
    <div className="wallet" style={{ flexWrap: 'wrap' }}>
      <div className="who">
        <b>{chainName}{connector ? ` · ${connector.name}` : devAddress ? ' · dev signer' : ''}</b>
        <code>{who ? `${short(who)}${usdc !== null ? ` · ${(Number(usdc) / 1e6).toFixed(2)} USDC` : ''}` : 'Any EVM wallet · gas paid for you'}</code>
      </div>
      {who && !devAddress
        ? <button className="btn ghost sm" type="button" onClick={() => disconnect()}>Disconnect</button>
        : !who && (picking
          ? <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{connectors.map((c) => (
              <button key={c.uid} className="btn ghost sm" type="button" disabled={isPending} onClick={() => connect({ connector: c })}>{c.name}</button>
            ))}</span>
          : <button className="btn ink sm" type="button" onClick={() => setPicking(true)}>Connect</button>)}
    </div>
  );
}
