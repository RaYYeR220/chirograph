import type { BchNetwork } from '@chirograph/sdk';

const env = import.meta.env;

export const CONFIG = {
  solverUrl: (env.VITE_SOLVER_URL as string | undefined) ?? 'http://127.0.0.1:8787',
  bchNetwork: ((env.VITE_BCH_NETWORK as string | undefined) ?? 'mainnet') as BchNetwork,
  electrumHost: env.VITE_ELECTRUM_HOST as string | undefined,
  walletConnectProjectId: env.VITE_WC_PROJECT_ID as string | undefined,
  /** Optional per-chain RPC overrides, e.g. a local fork during development. */
  rpc: {
    8453: env.VITE_BASE_RPC as string | undefined,
    42161: env.VITE_ARBITRUM_RPC as string | undefined,
  } as Record<number, string | undefined>,
  /** BLAZE banner links. */
  deckUrl: (env.VITE_DECK_URL as string | undefined) ?? '#',
  repoUrl: (env.VITE_REPO_URL as string | undefined) ?? '#',
  emberAddress: (env.VITE_EMBER_ADDRESS as string | undefined) ?? '',
};

export const BCH_TX_URL = (txid: string) =>
  CONFIG.bchNetwork === 'mainnet'
    ? `https://explorer.selene.cash/tx/${txid}`
    : `https://explorer.selene.cash/tx/${txid}?network=chipnet`;

export const BCH_ADDRESS_URL = (address: string) =>
  CONFIG.bchNetwork === 'mainnet'
    ? `https://explorer.selene.cash/address/${address}`
    : `https://explorer.selene.cash/address/${address}?network=chipnet`;
