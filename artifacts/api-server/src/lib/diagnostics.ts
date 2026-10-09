/**
 * Lightweight process / job diagnostics for ops.
 * Bound metrics only — no secrets, guild content, or per-request spam.
 */
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { getRenderPoolMetrics } from "../bot/canvas/render-pool";

export interface ProcessMemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
}

export interface CpuSnapshot {
  userMs: number;
  systemMs: number;
}

export interface JobMetricsSnapshot {
  ticks: number;
  tickOverlapsSkipped: number;
  lastTickAt: string | null;
  lastTickDurationMs: number | null;
  tickFailures: number;
}

export interface DiagnosticsSnapshot {
  at: string;
  uptimeSec: number;
  pid: number;
  node: string;
  memory: ProcessMemorySnapshot;
  cpu: CpuSnapshot;
  eventLoop: {
    delayMeanMs: number | null;
    utilization: number | null;
  };
  render: ReturnType<typeof getRenderPoolMetrics>;
  jobs: JobMetricsSnapshot;
  shutdown: { requested: boolean; reason: string | null };
}

const jobMetrics: JobMetricsSnapshot = {
  ticks: 0,
  tickOverlapsSkipped: 0,
  lastTickAt: null,
  lastTickDurationMs: null,
  tickFailures: 0,
};

let shutdownRequested = false;
let shutdownReason: string | null = null;
let delayHistogram: ReturnType<typeof monitorEventLoopDelay> | null = null;
let eluBaseline: ReturnType<typeof performance.eventLoopUtilization> | null = null;

function mb(n: number): number {
  return Math.round((n / (1024 * 1024)) * 10) / 10;
}

/** Start optional event-loop delay sampling. */
export function startDiagnosticsMonitors(): void {
  if (!delayHistogram) {
    try {
      delayHistogram = monitorEventLoopDelay({ resolution: 20 });
      delayHistogram.enable();
    } catch {
      delayHistogram = null;
    }
  }
  if (!eluBaseline && typeof performance.eventLoopUtilization === "function") {
    eluBaseline = performance.eventLoopUtilization();
  }
}

export function markShutdown(reason: string): void {
  shutdownRequested = true;
  shutdownReason = reason;
}

export function recordSchedulerTick(opts: {
  durationMs: number;
  failed?: boolean;
  skippedOverlap?: boolean;
}): void {
  if (opts.skippedOverlap) {
    jobMetrics.tickOverlapsSkipped += 1;
    return;
  }
  jobMetrics.ticks += 1;
  jobMetrics.lastTickAt = new Date().toISOString();
  jobMetrics.lastTickDurationMs = opts.durationMs;
  if (opts.failed) jobMetrics.tickFailures += 1;
}

export function getJobMetrics(): JobMetricsSnapshot {
  return { ...jobMetrics };
}

export function snapshotDiagnostics(): DiagnosticsSnapshot {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();

  let delayMeanMs: number | null = null;
  if (delayHistogram) {
    delayMeanMs = Math.round((delayHistogram.mean / 1e6) * 100) / 100;
  }

  let utilization: number | null = null;
  if (eluBaseline && typeof performance.eventLoopUtilization === "function") {
    const elu = performance.eventLoopUtilization(eluBaseline);
    utilization = Math.round(elu.utilization * 1000) / 1000;
  }

  return {
    at: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
    node: process.version,
    memory: {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
      arrayBuffersMb: mb(mem.arrayBuffers ?? 0),
    },
    cpu: {
      userMs: Math.round(cpu.user / 1000),
      systemMs: Math.round(cpu.system / 1000),
    },
    eventLoop: { delayMeanMs, utilization },
    render: getRenderPoolMetrics(),
    jobs: getJobMetrics(),
    shutdown: { requested: shutdownRequested, reason: shutdownReason },
  };
}
