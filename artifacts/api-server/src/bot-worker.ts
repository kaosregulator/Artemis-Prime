/**
 * Discord bot worker thread entry point.
 *
 * Running the bot in a dedicated worker thread gives it its own Node.js event
 * loop. Canvas draw calls (synchronous CPU work from @napi-rs/canvas) run in a
 * nested render-worker thread so they never block Discord interaction
 * acknowledgements on this event loop.
 *
 * Schema ensure runs once in the main API process before this worker is
 * spawned (and drizzle-kit push runs at container start). Skipping a second
 * ensureSchema here avoids duplicate pg work on the bot's separate Pool.
 */
import { startBot, getClient } from "./bot/index.js";
import { stopScheduler } from "./bot/scheduler.js";
import { shutdownRenderPool } from "./bot/canvas/render-pool.js";
import { stopScoutAutoSnapshots } from "./bot/services/scout/index.js";
import { startDiagnosticsMonitors } from "./lib/diagnostics.js";
import { installSignalHandlers, onShutdown } from "./lib/shutdown.js";
import { logger } from "./lib/logger.js";
import { pool } from "@workspace/db";

startDiagnosticsMonitors();
installSignalHandlers();

onShutdown(async () => {
  stopScheduler();
  stopScoutAutoSnapshots();
  await shutdownRenderPool();
  const client = getClient();
  if (client) {
    try {
      client.destroy();
    } catch (err) {
      logger.warn({ err }, "Discord client destroy failed");
    }
  }
  await pool.end().catch(() => undefined);
});

startBot();
