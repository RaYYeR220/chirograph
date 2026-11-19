import { createConfig, http } from 'wagmi';
import { base, arbitrum } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { createPublicClient, type PublicClient } from 'viem';
import { CONFIG } from './config';

const connectors = [
  injected(),
  coinbaseWallet({ appName: 'Chirograph', preference: 'all' }),
  ...(CONFIG.walletConnectProjectId
    ? [walletConnect({ projectId: CONFIG.walletConnectProjectId, metadata: {
        name: 'Chirograph', description: 'USDC <-> PUSD atomic swaps', url: location.origin, icons: [`${location.origin}/icon.png`],
      } })]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [base, arbitrum],
  connectors,
  transports: {
    [base.id]: http(CONFIG.rpc[base.id]),
    [arbitrum.id]: http(CONFIG.rpc[arbitrum.id]),
  },
});

const clients = new Map<number, PublicClient>();
/** Read-only client per chain, independent of which wallet (if any) is connected. */
export function publicClient(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    const chain = chainId === arbitrum.id ? arbitrum : base;
    c = createPublicClient({ chain, transport: http(CONFIG.rpc[chainId]) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

export const EVM_TX_URL = (chainId: number, hash: string) =>
  chainId === arbitrum.id ? `https://arbiscan.io/tx/${hash}` : `https://basescan.org/tx/${hash}`;
export const EVM_ADDRESS_URL = (chainId: number, a: string) =>
  chainId === arbitrum.id ? `https://arbiscan.io/address/${a}` : `https://basescan.org/address/${a}`;
