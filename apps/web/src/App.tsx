import { useEffect, useState } from 'react';
import type { SolverInfo } from '@chirograph/sdk';
import { solver } from './lib/swaps';

export function App() {
  const [info, setInfo] = useState<SolverInfo | null>(null);
  useEffect(() => { solver.info().then(setInfo).catch(() => setInfo(null)); }, []);
  return <pre>{info ? JSON.stringify(info, null, 2) : 'connecting to solver…'}</pre>;
}
