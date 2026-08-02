import { typeid } from "typeid-js";
import { z } from "zod";
import {
  apiHttpPack,
  builderClientPack,
  cloudflarePack,
  corePack,
  httpListenPack,
  publicUrlPack,
  stripePack,
} from "./packs";

const workerConsumerPack = {
  WORKER_CONSUMER_NAME: z
    .string()
    .optional()
    .default(() => typeid("wkr").toString()),
} satisfies z.ZodRawShape;

/** Infra every process needs (db, redis, s3, process knobs). */
export const builderEnvShape = {
  ...corePack,
  ...builderClientPack,
  ...httpListenPack,
  PORT: z.coerce.number().int().positive().optional().default(3015),
} satisfies z.ZodRawShape;

export const workerEnvShape = {
  ...corePack,
  ...publicUrlPack,
  ...cloudflarePack,
  ...stripePack,
  ...workerConsumerPack,
} satisfies z.ZodRawShape;

export const apiEnvShape = {
  ...corePack,
  ...publicUrlPack,
  ...cloudflarePack,
  ...stripePack,
  ...builderClientPack,
  ...httpListenPack,
  ...apiHttpPack,
  PORT: z.coerce.number().int().positive().optional().default(3005),
} satisfies z.ZodRawShape;

/** Union of api + worker (single-process deploy). */
export const combinedEnvShape = {
  ...apiEnvShape,
  ...workerConsumerPack,
} satisfies z.ZodRawShape;

export type BuilderEnv = z.infer<z.ZodObject<typeof builderEnvShape>>;
export type WorkerEnv = z.infer<z.ZodObject<typeof workerEnvShape>>;
export type ApiEnv = z.infer<z.ZodObject<typeof apiEnvShape>>;
export type CombinedEnv = z.infer<z.ZodObject<typeof combinedEnvShape>>;

/**
 * Process-wide env surface for shared leaves. Mode packs guarantee the keys
 * each process actually needs; builder/worker binds are cast into this shape.
 */
export type BoundEnv = CombinedEnv;
