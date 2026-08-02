import type { BoundEnv } from "./schemas";

let bound: BoundEnv | undefined;

export let IS_CLOUD_EDITION = false;

/** Base URL for provider webhook callbacks (SNS, DMARC inbound). */
export let WEBHOOK_BASE_URL = "";

export function bindEnv(next: BoundEnv) {
  if (bound) {
    throw new Error("env already bound for this process");
  }
  bound = next;
  IS_CLOUD_EDITION = next.EDITION === "cloud";
  if ("API_URL" in next && typeof next.API_URL === "string") {
    const proxy =
      "API_PROXY_URL" in next && typeof next.API_PROXY_URL === "string"
        ? next.API_PROXY_URL
        : undefined;
    WEBHOOK_BASE_URL = proxy ?? next.API_URL;
  }
}

export function getBoundEnv(): BoundEnv {
  if (!bound) {
    throw new Error("env read before bindEnv()");
  }
  return bound;
}

/**
 * Bound process env. Prefer importing this after process entry has loaded
 * `@repo/api/env` (auto-binds from `RUN_MODE`).
 */
export const env: BoundEnv = new Proxy({} as BoundEnv, {
  get(_target, prop, receiver) {
    const current = getBoundEnv();
    const value = Reflect.get(current, prop, receiver);
    return value;
  },
  has(_target, prop) {
    return Reflect.has(getBoundEnv(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(getBoundEnv());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getBoundEnv(), prop);
  },
});
