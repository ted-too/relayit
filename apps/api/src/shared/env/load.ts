import {
  assertCloudCloudflareEnv,
  assertCloudGitHubEnv,
  assertCloudStripeEnv,
} from "./asserts";
import { bindEnv } from "./bind";
import { runtimeModes, type RunMode } from "./packs";
import { parseEnv } from "./parse";
import {
  type ApiEnv,
  apiEnvShape,
  type BoundEnv,
  type BuilderEnv,
  builderEnvShape,
  type CombinedEnv,
  combinedEnvShape,
  type WorkerEnv,
  workerEnvShape,
} from "./schemas";

export function peekRunMode(): RunMode {
  const raw = Bun.env.RUN_MODE;
  if (raw === "" || raw === undefined) {
    return "combined";
  }
  if ((runtimeModes as readonly string[]).includes(raw)) {
    return raw as RunMode;
  }
  throw new Error(
    `Unsupported RUN_MODE: ${raw} (expected ${runtimeModes.join(", ")})`
  );
}

function assertForMode(mode: RunMode, parsed: BoundEnv) {
  if (mode === "builder") {
    return;
  }

  assertCloudStripeEnv(
    mode === "api" || mode === "combined"
      ? {
          STRIPE_WEBHOOK_SECRET:
            "STRIPE_WEBHOOK_SECRET" in parsed
              ? parsed.STRIPE_WEBHOOK_SECRET
              : undefined,
        }
      : {}
  );
  assertCloudCloudflareEnv();

  if (mode === "api" || mode === "combined") {
    assertCloudGitHubEnv({
      GITHUB_CLIENT_ID:
        "GITHUB_CLIENT_ID" in parsed ? parsed.GITHUB_CLIENT_ID : undefined,
      GITHUB_CLIENT_SECRET:
        "GITHUB_CLIENT_SECRET" in parsed
          ? parsed.GITHUB_CLIENT_SECRET
          : undefined,
    });
  }
}

/**
 * Parse the pack matrix for `mode`, bind the process-wide env singleton, and
 * run cloud asserts for modes that need them.
 */
export function loadEnv(mode: RunMode = peekRunMode()): BoundEnv {
  let parsed: BoundEnv;

  switch (mode) {
    case "builder": {
      parsed = parseEnv(builderEnvShape) as BoundEnv;
      break;
    }
    case "worker": {
      parsed = parseEnv(workerEnvShape) as BoundEnv;
      break;
    }
    case "api": {
      parsed = parseEnv(apiEnvShape) as BoundEnv;
      break;
    }
    case "combined": {
      parsed = parseEnv(combinedEnvShape) as BoundEnv;
      break;
    }
    default: {
      throw new Error(`Unsupported RUN_MODE: ${mode}`);
    }
  }

  bindEnv(parsed);
  assertForMode(mode, parsed);
  return parsed;
}

export type { ApiEnv, BoundEnv, BuilderEnv, CombinedEnv, WorkerEnv };
