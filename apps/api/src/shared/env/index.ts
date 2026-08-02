import { loadEnv, peekRunMode } from "./load";

export {
  assertCloudCloudflareEnv,
  assertCloudGitHubEnv,
  assertCloudStripeEnv,
  requireCloudflareEnv,
} from "./asserts";
export {
  bindEnv,
  env,
  getBoundEnv,
  IS_CLOUD_EDITION,
  WEBHOOK_BASE_URL,
} from "./bind";
export type { ApiEnv, BoundEnv, BuilderEnv, CombinedEnv, WorkerEnv } from "./load";
export { loadEnv, peekRunMode } from "./load";
export {
  apiHttpPack,
  builderClientPack,
  cloudflarePack,
  corePack,
  dbPack,
  httpListenPack,
  logLevels,
  processBasePack,
  publicUrlPack,
  type RunMode,
  runtimeModes,
  s3Pack,
  stripePack,
} from "./packs";
export { parseEnv } from "./parse";
export {
  apiEnvShape,
  builderEnvShape,
  combinedEnvShape,
  workerEnvShape,
} from "./schemas";

// Composition root: bind packs for this process from RUN_MODE before any leaf
// reads `env`. Import packs/parse via subpaths when you must avoid this.
loadEnv(peekRunMode());
