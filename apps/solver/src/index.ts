import { loadConfig } from './config.js';
import { SwapStore } from './db.js';
import { BchSide } from './bch.js';
import { EvmSide } from './evm.js';
import { Engine } from './engine.js';
import { buildServer } from './server.js';
import type { EvmChainKey } from '@chirograph/sdk';

const cfg = loadConfig();
const store = new SwapStore(cfg.dbPath);
const bch = new BchSide(cfg);
const evm = new Map<EvmChainKey, EvmSide>(cfg.chains.map((c) => [c.key, new EvmSide(c, cfg)]));
const engine = new Engine(cfg, store, bch, evm);
const app = await buildServer(engine);

// The watcher: advance every open swap, including refunds, forever. Each pass is idempotent.
let ticking = false;
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await engine.tick();
  } catch (err) {
    app.log.error({ err }, 'tick failed');
  } finally {
    ticking = false;
  }
}, cfg.pollMs);

await app.listen({ port: cfg.port, host: '0.0.0.0' });
app.log.info({
  bch: bch.tokenAddress,
  evm: [...evm.values()].map((s) => `${s.chain.name}:${s.address}`),
  network: cfg.bchNetwork,
}, 'solver up');
