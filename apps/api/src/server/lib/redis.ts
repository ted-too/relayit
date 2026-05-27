import { env } from "@repo/api/env";
import { RedisClient } from "bun";

export const apiRedis = new RedisClient(env.REDIS_URL);
