/** An error caused by the request itself; its message is safe to show to the caller. */
export class UserError extends Error {
  readonly statusCode = 400;
}

/** Strip URLs (RPC endpoints may carry keys) and long hex blobs, and cap the length. */
export function publicMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/https?:\/\/\S+/g, '[endpoint]')
    .replace(/wss?:\/\/\S+/g, '[endpoint]')
    .replace(/0x[0-9a-fA-F]{200,}/g, '[data]')
    .split('\n')[0]!
    .slice(0, 200);
}
