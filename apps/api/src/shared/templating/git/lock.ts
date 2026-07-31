import type { RedisClient } from "bun";

/** Publish / deps sync can run longer than a short edit lock. */
const LOCK_TTL_SECONDS = 300;

export async function withWorkspaceGitLock<T>(
  redis: RedisClient,
  workspaceId: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = `templating:git-lock:${workspaceId}`;
  const token = crypto.randomUUID();

  const acquired = await redis.send("SET", [
    key,
    token,
    "NX",
    "EX",
    String(LOCK_TTL_SECONDS),
  ]);

  if (acquired !== "OK") {
    throw new Error(`Workspace ${workspaceId} is busy; retry shortly`);
  }

  try {
    return await fn();
  } finally {
    const current = await redis.send("GET", [key]);
    if (current === token) {
      await redis.send("DEL", [key]);
    }
  }
}
