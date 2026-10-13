import { hostname } from 'node:os';
import type { Deps } from '../lib/deps';
import { claimNextJob, processJob, recoverStaleJobs } from './extraction';
import { runRetention, scanDeadlines } from './maintenance';

export interface WorkerOptions {
  pollMs: number;
  log: (msg: string, extra?: Record<string, unknown>) => void;
  signal: AbortSignal;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** Long-running worker loop: extraction jobs + periodic maintenance. */
export async function runWorker(deps: Pick<Deps, 'prisma' | 'storage' | 'ai'>, opts: WorkerOptions) {
  const workerId = `${hostname()}:${process.pid}`;
  let lastMaintenance = 0;
  opts.log('Worker dimulai', { workerId });
  while (!opts.signal.aborted) {
    try {
      if (Date.now() - lastMaintenance > 60_000) {
        lastMaintenance = Date.now();
        const recovered = await recoverStaleJobs(deps.prisma);
        const notified = await scanDeadlines(deps.prisma);
        const { purged } = await runRetention(deps.prisma);
        if (recovered || notified || purged) opts.log('Pemeliharaan', { recovered, notified, purged });
      }
      const id = await claimNextJob(deps.prisma, workerId);
      if (id) {
        opts.log('Memproses job', { jobId: id });
        await processJob(deps, id);
        continue;
      }
    } catch (err) {
      opts.log('Kesalahan worker', { error: (err as Error).message });
    }
    await sleep(opts.pollMs, opts.signal);
  }
  opts.log('Worker berhenti');
}
