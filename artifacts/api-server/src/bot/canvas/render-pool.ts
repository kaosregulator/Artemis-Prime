/**
 * Render worker pool with bounded queue, serialized jobs, and hard timeouts.
 *
 * Pool size stays at 1 for 256 MB hosts (Northflank Free). Canvas work is
 * CPU/RAM heavy; more workers would raise native memory without helping much
 * for a community-scale bot.
 *
 * Timeouts terminate the worker (soft promise rejection alone does not stop
 * @napi-rs/canvas work). Jobs are serialized per worker so concurrent
 * dispatches cannot pile up native surfaces in one thread.
 */
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { logger } from "../../lib/logger";

const POOL_SIZE = 1;
const RENDER_TIMEOUT_MS = 20_000;
/** Reject new work once this many jobs are waiting (plus in-flight). */
const MAX_QUEUE = 8;
/** Cap how long we keep per-fn timing samples. */
const MAX_DURATION_SAMPLES = 32;

interface Pending {
  id: number;
  fn: string;
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
  worker: Worker;
  timer: ReturnType<typeof setTimeout>;
  queuedAt: number;
  startedAt: number;
}

interface QueuedJob {
  id: number;
  fn: string;
  params: unknown;
  resolve: (buf: Buffer) => void;
  reject: (err: Error) => void;
  queuedAt: number;
}

export interface RenderPoolMetrics {
  poolSize: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  timeouts: number;
  rejected: number;
  rebuilds: number;
  /** Rolling average duration (ms) of completed renders, or null if none. */
  avgDurationMs: number | null;
  lastDurationMs: number | null;
  lastFn: string | null;
}

const pending = new Map<number, Pending>();
const queue: QueuedJob[] = [];
let nextId = 1;
let workers: Worker[] = [];
/** Worker currently executing a job (serialized). */
const busy = new WeakSet<Worker>();
let shuttingDown = false;

const metrics = {
  completed: 0,
  failed: 0,
  timeouts: 0,
  rejected: 0,
  rebuilds: 0,
  durations: [] as number[],
  lastDurationMs: null as number | null,
  lastFn: null as string | null,
};

function recordDuration(fn: string, ms: number): void {
  metrics.lastDurationMs = ms;
  metrics.lastFn = fn;
  metrics.durations.push(ms);
  if (metrics.durations.length > MAX_DURATION_SAMPLES) metrics.durations.shift();
}

function failWorkerPending(w: Worker, reason: string): void {
  for (const [id, p] of pending) {
    if (p.worker !== w) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    busy.delete(w);
    metrics.failed += 1;
    p.reject(new Error(reason));
  }
}

function rebuildWorker(old: Worker): Worker {
  const idx = workers.indexOf(old);
  metrics.rebuilds += 1;
  const next = buildWorker();
  if (idx >= 0) workers[idx] = next;
  else workers.push(next);
  try {
    void old.terminate();
  } catch {
    /* already dead */
  }
  return next;
}

function buildWorker(): Worker {
  const workerPath = fileURLToPath(new URL("./bot/canvas/render-worker.mjs", import.meta.url));
  const w = new Worker(workerPath);

  w.on("message", ({ id, buf, error }: { id: number; buf?: ArrayBuffer; error?: string }) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    busy.delete(p.worker);
    const durationMs = Date.now() - p.startedAt;
    if (error !== undefined) {
      metrics.failed += 1;
      p.reject(new Error(error));
    } else {
      metrics.completed += 1;
      recordDuration(p.fn, durationMs);
      p.resolve(Buffer.from(buf!));
    }
    pump();
  });

  w.on("error", (err) => {
    logger.error({ err }, "Render worker error — rebuilding");
    failWorkerPending(w, "Render worker crashed");
    if (!shuttingDown) rebuildWorker(w);
    pump();
  });

  w.on("exit", (code) => {
    busy.delete(w);
    if (shuttingDown) return;
    // Rebuild on any unexpected exit (including code 0) so the pool never
    // silently loses its only worker.
    if (workers.includes(w)) {
      logger.warn({ code }, "Render worker exited — rebuilding");
      failWorkerPending(w, `Render worker exited (code ${code})`);
      rebuildWorker(w);
      pump();
    }
  });

  return w;
}

function pickIdleWorker(): Worker | null {
  for (const w of workers) {
    if (!busy.has(w)) return w;
  }
  return null;
}

function startJob(w: Worker, job: QueuedJob): void {
  busy.add(w);
  const startedAt = Date.now();
  const waitMs = startedAt - job.queuedAt;
  const timer = setTimeout(() => {
    if (!pending.has(job.id)) return;
    pending.delete(job.id);
    busy.delete(w);
    metrics.timeouts += 1;
    logger.warn(
      { fn: job.fn, timeoutMs: RENDER_TIMEOUT_MS, waitMs, queueDepth: queue.length },
      "Render timed out — terminating worker"
    );
    job.reject(new Error(`Render "${job.fn}" timed out after ${RENDER_TIMEOUT_MS}ms`));
    // Hard-cancel: soft reject does not stop canvas CPU work on the worker.
    failWorkerPending(w, `Render "${job.fn}" cancelled after timeout`);
    if (!shuttingDown) rebuildWorker(w);
    pump();
  }, RENDER_TIMEOUT_MS);

  pending.set(job.id, {
    id: job.id,
    fn: job.fn,
    resolve: job.resolve,
    reject: job.reject,
    worker: w,
    timer,
    queuedAt: job.queuedAt,
    startedAt,
  });
  w.postMessage({ id: job.id, fn: job.fn, params: job.params });
}

function pump(): void {
  if (shuttingDown) return;
  while (queue.length > 0) {
    const w = pickIdleWorker();
    if (!w) break;
    const job = queue.shift()!;
    startJob(w, job);
  }
}

export function initRenderPool(): void {
  if (workers.length > 0) return;
  shuttingDown = false;
  workers = Array.from({ length: POOL_SIZE }, buildWorker);
  logger.info({ poolSize: POOL_SIZE, maxQueue: MAX_QUEUE }, "Render worker pool initialised");
}

export function getRenderPoolMetrics(): RenderPoolMetrics {
  const avg =
    metrics.durations.length > 0
      ? Math.round(metrics.durations.reduce((a, b) => a + b, 0) / metrics.durations.length)
      : null;
  return {
    poolSize: workers.length || POOL_SIZE,
    active: pending.size,
    queued: queue.length,
    completed: metrics.completed,
    failed: metrics.failed,
    timeouts: metrics.timeouts,
    rejected: metrics.rejected,
    rebuilds: metrics.rebuilds,
    avgDurationMs: avg,
    lastDurationMs: metrics.lastDurationMs,
    lastFn: metrics.lastFn,
  };
}

/**
 * Drain the queue, reject in-flight jobs, and terminate workers.
 * Safe to call during SIGTERM / worker shutdown.
 */
export async function shutdownRenderPool(): Promise<void> {
  shuttingDown = true;
  while (queue.length) {
    const job = queue.shift()!;
    metrics.rejected += 1;
    job.reject(new Error("Render pool shutting down"));
  }
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    metrics.failed += 1;
    p.reject(new Error("Render pool shutting down"));
  }
  pending.clear();
  const dying = workers.splice(0, workers.length);
  await Promise.all(
    dying.map((w) =>
      w.terminate().catch(() => 0)
    )
  );
}

/**
 * Dispatch a canvas render to a worker thread.
 *
 * Params must be structured-cloneable. Prefer avatarUrl over Image objects.
 * Rejects immediately when the bounded queue is full (backpressure).
 */
export function renderOffThread(fn: string, params: unknown): Promise<Buffer> {
  if (shuttingDown) {
    return Promise.reject(new Error("Render pool shutting down"));
  }
  if (workers.length === 0) initRenderPool();

  if (pending.size + queue.length >= MAX_QUEUE) {
    metrics.rejected += 1;
    logger.warn(
      { fn, active: pending.size, queued: queue.length, maxQueue: MAX_QUEUE },
      "Render queue full — rejecting"
    );
    return Promise.reject(
      new Error(`Render queue full (${MAX_QUEUE}) — try again shortly`)
    );
  }

  return new Promise((resolve, reject) => {
    const id = nextId++;
    queue.push({ id, fn, params, resolve, reject, queuedAt: Date.now() });
    pump();
  });
}

/** Test helpers — reset counters without requiring a live worker. */
export function __resetRenderPoolForTests(): void {
  shuttingDown = false;
  queue.length = 0;
  pending.clear();
  metrics.completed = 0;
  metrics.failed = 0;
  metrics.timeouts = 0;
  metrics.rejected = 0;
  metrics.rebuilds = 0;
  metrics.durations.length = 0;
  metrics.lastDurationMs = null;
  metrics.lastFn = null;
}
