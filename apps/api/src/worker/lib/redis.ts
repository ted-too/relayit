import { env } from "@repo/api/env";
import { RedisClient } from "bun";

export const workerRedis = new RedisClient(env.REDIS_URL);
