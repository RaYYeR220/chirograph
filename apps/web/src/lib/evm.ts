import { createConfig, http } from 'wagmi';
import { base, arbitrum, optimism, polygon } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { createPublicClient, type PublicClient } from 'viem';
import { CONFIG } from './config';
import { explorerById } from './chains';

const CHAINS = [base, arbitrum, optimism, polygon] as const;

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
  chains: CHAINS,
  connectors,
  transports: {
    [base.id]: http(CONFIG.rpc[base.id]),
    [arbitrum.id]: http(CONFIG.rpc[arbitrum.id]),
    [optimism.id]: http(CONFIG.rpc[optimism.id]),
    [polygon.id]: http(CONFIG.rpc[polygon.id]),
  },
});

const clients = new Map<number, PublicClient>();
/** Read-only client per chain, independent of which wallet (if any) is connected. */
export function publicClient(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    const chain = CHAINS.find((c) => c.id === chainId) ?? base;
    c = createPublicClient({ chain, transport: http(CONFIG.rpc[chainId]) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

export const EVM_TX_URL = (chainId: number, hash: string) => `${explorerById(chainId)}/tx/${hash}`;
export const EVM_ADDRESS_URL = (chainId: number, a: string) => `${explorerById(chainId)}/address/${a}`;
