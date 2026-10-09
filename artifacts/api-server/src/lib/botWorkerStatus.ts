/** Cross-cutting bot-worker liveness for the API process (worker thread). */

export interface BotWorkerStatus {
  alive: boolean;
  restarts: number;
  lastExitCode: number | null;
  lastExitAt: string | null;
  startedAt: string | null;
}

const status: BotWorkerStatus = {
  alive: false,
  restarts: 0,
  lastExitCode: null,
  lastExitAt: null,
  startedAt: null,
};

export function markBotWorkerStarted(): void {
  status.alive = true;
  status.startedAt = new Date().toISOString();
}

export function markBotWorkerExited(code: number | null): void {
  status.alive = false;
  status.lastExitCode = code;
  status.lastExitAt = new Date().toISOString();
  if (code !== 0) status.restarts += 1;
}

export function getBotWorkerStatus(): BotWorkerStatus {
  return { ...status };
}
