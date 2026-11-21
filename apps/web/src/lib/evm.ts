import { createConfig, fallback, http } from 'wagmi';
import { base, arbitrum, optimism, polygon } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { createPublicClient, type PublicClient } from 'viem';
import { EVM_CHAINS } from '@chirograph/sdk';
import { CONFIG } from './config';
import { explorerById } from './chains';

const CHAINS = [base, arbitrum, optimism, polygon] as const;

/**
 * An explicit RPC override (e.g. a local fork) is used alone. Otherwise the chain's public RPCs, in
 * order: one flaky endpoint must not stall a swap.
 */
function transportFor(chainId: number) {
  const known = Object.values(EVM_CHAINS).find((c) => c.chainId === chainId && !/fork|sepolia/i.test(c.key));
  const override = CONFIG.rpc[chainId];
  const urls = (override ? [override] : [known?.rpc, ...(known?.rpcFallbacks ?? [])])
    .filter((u): u is string => !!u).filter((u, i, a) => a.indexOf(u) === i);
  return urls.length > 1 ? fallback(urls.map((u) => http(u, { timeout: 10_000 }))) : http(urls[0]);
}

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
    [base.id]: transportFor(base.id),
    [arbitrum.id]: transportFor(arbitrum.id),
    [optimism.id]: transportFor(optimism.id),
    [polygon.id]: transportFor(polygon.id),
  },
});

/** One client per RPC endpoint (no fallback), for reads we want confirmed by more than one provider. */
export function singleClients(chainId: number): PublicClient[] {
  const known = Object.values(EVM_CHAINS).find((c) => c.chainId === chainId && !/fork|sepolia/i.test(c.key));
  const override = CONFIG.rpc[chainId];
  const urls = (override ? [override] : [known?.rpc, ...(known?.rpcFallbacks ?? [])])
    .filter((u): u is string => !!u).filter((u, i, a) => a.indexOf(u) === i);
  const chain = CHAINS.find((c) => c.id === chainId) ?? base;
  return urls.map((u) => createPublicClient({ chain, transport: http(u, { timeout: 10_000 }) }) as PublicClient);
}

const clients = new Map<number, PublicClient>();
/** Read-only client per chain, independent of which wallet (if any) is connected. */
export function publicClient(chainId: number): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    const chain = CHAINS.find((c) => c.id === chainId) ?? base;
    c = createPublicClient({ chain, transport: transportFor(chainId) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

export const EVM_TX_URL = (chainId: number, hash: string) => `${explorerById(chainId)}/tx/${hash}`;
export const EVM_ADDRESS_URL = (chainId: number, a: string) => `${explorerById(chainId)}/address/${a}`;
