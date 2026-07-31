import { env } from "@repo/api/worker/env";
import { RedisClient } from "bun";

export const workerRedis = new RedisClient(env.REDIS_URL);
