import { sha256, binToHex, hexToBin } from '@bitauth/libauth';

export const SECRET_BYTES = 32;

/** A fresh 32-byte secret from the platform CSPRNG (browser or Node 22). */
export function generateSecret(): Uint8Array {
  const secret = new Uint8Array(SECRET_BYTES);
  globalThis.crypto.getRandomValues(secret);
  return secret;
}

/** sha256(secret). Identical on Bitcoin Cash (OP_SHA256) and on EVM (the sha256 precompile). */
export function hashSecret(secret: Uint8Array): Uint8Array {
  if (secret.length !== SECRET_BYTES) throw new Error(`secret must be ${SECRET_BYTES} bytes`);
  return sha256.hash(secret);
}

export const toHex = (bytes: Uint8Array) => binToHex(bytes);
export const fromHex = (hex: string) => hexToBin(hex.startsWith('0x') ? hex.slice(2) : hex);
export const to0x = (bytes: Uint8Array) => `0x${binToHex(bytes)}` as const;
