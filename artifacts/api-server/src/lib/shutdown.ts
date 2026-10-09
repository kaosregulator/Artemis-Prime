/**
 * Coordinated graceful shutdown for the API process and bot worker.
 */
import { logger } from "./logger";
import { markShutdown } from "./diagnostics";

type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
let shuttingDown = false;

export function onShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export async function gracefulShutdown(reason: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  markShutdown(reason);
  logger.info({ reason }, "Graceful shutdown started");

  const timeout = setTimeout(() => {
    logger.warn("Graceful shutdown timed out — forcing exit");
    process.exit(exitCode || 1);
  }, 12_000);
  timeout.unref?.();

  for (const hook of [...hooks].reverse()) {
    try {
      await hook();
    } catch (err) {
      logger.warn({ err }, "Shutdown hook failed");
    }
  }

  clearTimeout(timeout);
  logger.info({ reason }, "Graceful shutdown complete");
  process.exit(exitCode);
}

/** Install SIGTERM/SIGINT handlers once. */
export function installSignalHandlers(): void {
  const handle = (signal: string) => {
    void gracefulShutdown(signal, 0);
  };
  process.once("SIGTERM", () => handle("SIGTERM"));
  process.once("SIGINT", () => handle("SIGINT"));
}
