import { EVM_CHAINS } from '@chirograph/sdk';

/** Display name and explorer for every EVM chain the app knows, by chain id. */
const BY_ID = new Map<number, { name: string; explorer: string }>();
for (const c of Object.values(EVM_CHAINS)) {
  if (!BY_ID.has(c.chainId)) BY_ID.set(c.chainId, { name: c.name.replace(/ \(.*\)$/, ''), explorer: c.explorer });
}

/** Chain id for a solver chain key (`baseFork` maps to Base, and so on). */
export function chainIdOf(key: string): number {
  return EVM_CHAINS[key as keyof typeof EVM_CHAINS]?.chainId ?? 8453;
}
export function chainName(key: string): string {
  return BY_ID.get(chainIdOf(key))?.name ?? key;
}
export function chainNameById(chainId: number): string {
  return BY_ID.get(chainId)?.name ?? `chain ${chainId}`;
}
export function explorerById(chainId: number): string {
  return BY_ID.get(chainId)?.explorer ?? 'https://basescan.org';
}
