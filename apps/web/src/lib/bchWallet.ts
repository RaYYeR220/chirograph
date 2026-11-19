import { ElectrumNetworkProvider, type SpendableUtxo } from 'cashscript';
import { binToHex, hash160, hexToBin, sha256, stringify, swapEndianness } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { bytecodeToAddress, type LockTxResult, type WalletUtxo } from '@chirograph/sdk';
import { CONFIG } from './config';

/** WizardConnect child indexes for the HD chains a wallet shares with us. */
const CHAINS = { receive: 0, change: 1 } as const;
type ChainName = keyof typeof CHAINS;

let provider: ElectrumNetworkProvider | undefined;
/** One shared, long-lived Electrum connection for the page. */
export async function bchProvider(): Promise<ElectrumNetworkProvider> {
  if (!provider) {
    provider = new ElectrumNetworkProvider(CONFIG.bchNetwork, {
      ...(CONFIG.electrumHost ? { hostname: CONFIG.electrumHost } : {}),
      manualConnectionManagement: true,
    });
    await provider.connect();
  }
  return provider;
}

export interface WalletAddress {
  chain: ChainName;
  index: number;
  address: string;
  tokenAddress: string;
  lockingBytecode: Uint8Array;
}

export interface WalletSnapshot {
  addresses: WalletAddress[];
  utxos: WalletUtxo[];
  sats: bigint;
  tokens: bigint;
  /** Where we ask solvers to pay PUSD (receive chain, index 0). */
  receive: WalletAddress;
}

/** Derive the first `count` addresses on a chain from the xpub the wallet shared over WizardConnect. */
export function deriveAddresses(manager: DappConnectionManager, chain: ChainName, count: number): WalletAddress[] {
  const out: WalletAddress[] = [];
  for (let i = 0; i < count; i++) {
    const pubkey = manager.getPubkey(CHAINS[chain], BigInt(i));
    if (!pubkey) break;
    const bytecode = Uint8Array.from([0x76, 0xa9, 0x14, ...hash160(pubkey), 0x88, 0xac]);
    out.push({
      chain, index: i, lockingBytecode: bytecode,
      address: bytecodeToAddress(bytecode, CONFIG.bchNetwork, false),
      tokenAddress: bytecodeToAddress(bytecode, CONFIG.bchNetwork, true),
    });
  }
  return out;
}

/**
 * WizardConnect hands us xpubs, not balances, so we scan the first addresses of the receive and
 * change chains ourselves. A small fixed window keeps the first paint fast; wallets that spread
 * funds further still work for receiving, they just show a lower spendable balance.
 */
export async function scanWallet(manager: DappConnectionManager, category: string, receiveCount = 20, changeCount = 10): Promise<WalletSnapshot> {
  const p = await bchProvider();
  const addresses = [...deriveAddresses(manager, 'receive', receiveCount), ...deriveAddresses(manager, 'change', changeCount)];
  const perAddress = await Promise.all(addresses.map(async (a) => {
    const utxos = await p.getUtxosForLockingBytecode(a.lockingBytecode);
    return utxos.map((u): WalletUtxo => ({ ...u, address: a.address, path: { chain: a.chain, index: a.index } }));
  }));
  const utxos = perAddress.flat();
  let sats = 0n;
  let tokens = 0n;
  for (const u of utxos) {
    sats += u.satoshis;
    if (u.token?.category === category && !u.token.nft) tokens += u.token.amount;
  }
  return { addresses, utxos, sats, tokens, receive: addresses[0]! };
}

/**
 * Ask the wallet to sign a lock we built, then broadcast it ourselves: Selene never broadcasts,
 * Paytaca does by default and Cashonize only on request, so the dapp always owns the broadcast.
 */
export async function signAndBroadcast(manager: DappConnectionManager, built: LockTxResult, prompt: string, signal?: AbortSignal): Promise<string> {
  const sourceOutputs = JSON.parse(stringify(built.wc.sourceOutputs));
  const response = await manager.signTransaction(
    {
      transaction: { transaction: built.txHex, sourceOutputs, broadcast: false, userPrompt: prompt },
      inputPaths: built.inputPaths,
    },
    { signal },
  );
  if (response.error) throw new Error(`wallet declined: ${response.error}`);
  const p = await bchProvider();
  try {
    return await p.sendRawTransaction(response.signedTransaction);
  } catch (err) {
    // A wallet that broadcast anyway (Paytaca) makes ours a duplicate; that is success.
    if (/already|known/i.test(String((err as Error).message))) return txidFromHex(response.signedTransaction);
    throw err;
  }
}

export async function waitForUtxo(
  find: () => Promise<SpendableUtxo | undefined>,
  timeoutMs = 30_000,
): Promise<SpendableUtxo> {
  const start = Date.now();
  for (;;) {
    const utxo = await find();
    if (utxo) return utxo;
    if (Date.now() - start > timeoutMs) throw new Error('the lock is not visible on Bitcoin Cash yet');
    await new Promise((r) => setTimeout(r, 400));
  }
}

function txidFromHex(hex: string): string {
  return swapEndianness(binToHex(sha256.hash(sha256.hash(hexToBin(hex)))));
}
