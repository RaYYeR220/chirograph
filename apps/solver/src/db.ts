import { DatabaseSync } from 'node:sqlite';
import type { SwapRecord } from '@chirograph/sdk';

/**
 * Swaps are stored as JSON documents keyed by id. Volume is tiny and every write is a whole
 * state transition, so a document table keeps the engine simple and the history auditable.
 */
export class SwapStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS swaps (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        doc TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS swaps_status ON swaps(status);
      CREATE INDEX IF NOT EXISTS swaps_created ON swaps(created_at);
    `);
  }

  put(swap: SwapRecord) {
    this.db
      .prepare(`INSERT INTO swaps (id, status, created_at, updated_at, doc) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, doc = excluded.doc`)
      .run(swap.id, swap.status, swap.createdAt, swap.updatedAt, JSON.stringify(swap));
  }

  get(id: string): SwapRecord | undefined {
    const row = this.db.prepare('SELECT doc FROM swaps WHERE id = ?').get(id) as { doc: string } | undefined;
    return row ? (JSON.parse(row.doc) as SwapRecord) : undefined;
  }

  open(): SwapRecord[] {
    const rows = this.db
      .prepare(`SELECT doc FROM swaps WHERE status NOT IN ('completed', 'refunded', 'failed') ORDER BY created_at`)
      .all() as Array<{ doc: string }>;
    return rows.map((r) => JSON.parse(r.doc) as SwapRecord);
  }

  recent(limit: number): SwapRecord[] {
    const rows = this.db.prepare('SELECT doc FROM swaps ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{ doc: string }>;
    return rows.map((r) => JSON.parse(r.doc) as SwapRecord);
  }

  /** Any swap (open or closed) that already used this BCH lock transaction. */
  byLockTxid(txid: string): SwapRecord | undefined {
    const row = this.db
      .prepare(`SELECT doc FROM swaps WHERE json_extract(doc, '$.bch.lockTxid') = ? LIMIT 1`)
      .get(txid) as { doc: string } | undefined;
    return row ? (JSON.parse(row.doc) as SwapRecord) : undefined;
  }

  stats() {
    return this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM swaps GROUP BY status`)
      .all() as Array<{ status: string; n: number }>;
  }
}
