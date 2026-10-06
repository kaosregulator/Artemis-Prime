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
import { startBot } from "./bot/index.js";

startBot();
