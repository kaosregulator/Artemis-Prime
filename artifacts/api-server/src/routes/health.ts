import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { snapshotDiagnostics, startDiagnosticsMonitors } from "../lib/diagnostics";
import { getBotWorkerStatus } from "../lib/botWorkerStatus";
import { logger } from "../lib/logger";

const router: IRouter = Router();

startDiagnosticsMonitors();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Authenticated / internal diagnostics.
 * Requires DIAGNOSTICS_TOKEN (Bearer or ?token=) when set.
 * Never returns secrets, tokens, or guild member PII.
 *
 * Note: canvas/render and Discord client metrics live in the bot worker
 * thread — they are logged there. This endpoint covers the API process,
 * Postgres pool, and bot-worker liveness.
 */
function diagnosticsAuthorized(req: Request): boolean {
  const expected = process.env.DIAGNOSTICS_TOKEN?.trim();
  if (!expected) {
    const ip = req.ip || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  }
  const header = req.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  return bearer === expected || queryToken === expected;
}

router.get("/diagnostics", async (req: Request, res: Response) => {
  if (!diagnosticsAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  let dbOk = false;
  let dbLatencyMs: number | null = null;
  try {
    const t0 = Date.now();
    await pool.query("select 1");
    dbLatencyMs = Date.now() - t0;
    dbOk = true;
  } catch (err) {
    logger.warn({ err }, "diagnostics db ping failed");
  }

  const snap = snapshotDiagnostics();
  const botWorker = getBotWorkerStatus();

  res.json({
    status: dbOk && botWorker.alive ? "ok" : "degraded",
    ...snap,
    database: {
      ok: dbOk,
      latencyMs: dbLatencyMs,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    },
    botWorker,
  });
});

export default router;
