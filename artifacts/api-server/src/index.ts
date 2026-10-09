import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { ensureSchema } from "./lib/ensureSchema";
import { installSignalHandlers, onShutdown } from "./lib/shutdown";
import { startDiagnosticsMonitors } from "./lib/diagnostics";
import { markBotWorkerExited, markBotWorkerStarted } from "./lib/botWorkerStatus";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let botWorker: Worker | null = null;
let allowBotRestart = true;
let httpServer: Server | null = null;

function spawnBotWorker() {
  if (!allowBotRestart) return;
  const workerPath = fileURLToPath(new URL("./bot-worker.mjs", import.meta.url));
  const worker = new Worker(workerPath);
  botWorker = worker;
  markBotWorkerStarted();

  worker.on("error", (err) => {
    logger.error({ err }, "Bot worker error");
  });

  worker.on("exit", (code) => {
    markBotWorkerExited(code);
    botWorker = null;
    if (!allowBotRestart) return;
    if (code !== 0) {
      logger.warn({ code }, "Bot worker exited — restarting in 5 s");
      setTimeout(spawnBotWorker, 5_000);
    }
  });
}

installSignalHandlers();
startDiagnosticsMonitors();

onShutdown(async () => {
  allowBotRestart = false;
  if (botWorker) {
    await botWorker.terminate().catch(() => 0);
    botWorker = null;
  }
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close(() => resolve());
    });
  }
  await pool.end().catch(() => undefined);
});

httpServer = app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // No separate release phase on Railway/Northflank — add missing columns
  // before the Discord bot starts answering /link, /leaderboard, and cards.
  try {
    await ensureSchema();
  } catch {
    // Logged inside ensureSchema; continue so HTTP health checks still pass.
  }

  // Spawn the bot in a dedicated worker thread. Canvas rendering (CPU-bound
  // synchronous work) runs on the worker's event loop and never blocks HTTP
  // request handling or Discord interaction acknowledgements on the main thread.
  spawnBotWorker();
}) as Server;
