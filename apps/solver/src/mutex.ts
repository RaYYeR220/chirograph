/** Serialises async sections; used so the solver never double-spends its own UTXOs or nonces. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const now = () => Math.floor(Date.now() / 1000);
