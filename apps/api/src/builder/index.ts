import {
  builderCommitFiles,
  builderDepsSync,
  builderListFiles,
  builderPublish,
  builderReadFile,
} from "@repo/api/templating/builder";
import { logger } from "@repo/api/utils";
import { RedisClient } from "bun";
import { Elysia } from "elysia";
import { env } from "./env";

const redis = new RedisClient(env.REDIS_URL);

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function resultResponse<T>(result: {
  error: { message: string; details: string[] } | null;
  data: T | null;
}) {
  if (result.error) {
    return new Response(
      JSON.stringify({
        error: result.error.message,
        details: result.error.details,
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );
  }
  return Response.json({ data: result.data });
}

function assertBuilderAuth(request: Request): boolean {
  if (!env.TEMPLATING_BUILDER_SECRET) {
    return true;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${env.TEMPLATING_BUILDER_SECRET}`;
}

export const builderApp = new Elysia({
  serve: { hostname: env.HOST },
})
  .get("/health", () => ({ status: "ok", role: "templating-builder" }))
  .onBeforeHandle(({ request }) => {
    if (new URL(request.url).pathname === "/health") {
      return;
    }
    if (!assertBuilderAuth(request)) {
      return unauthorized();
    }
  })
  .get("/internal/files", async ({ request }) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      return resultResponse({
        error: { message: "workspaceId is required", details: [] },
        data: null,
      });
    }
    return resultResponse(
      await builderListFiles({
        workspaceId,
        ref: url.searchParams.get("ref") ?? undefined,
      })
    );
  })
  .get("/internal/file", async ({ request }) => {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const path = url.searchParams.get("path");
    if (!(workspaceId && path)) {
      return resultResponse({
        error: { message: "workspaceId and path are required", details: [] },
        data: null,
      });
    }
    return resultResponse(
      await builderReadFile({
        workspaceId,
        path,
        ref: url.searchParams.get("ref") ?? undefined,
      })
    );
  })
  .post("/internal/commit", async ({ body }) => {
    const payload = body as {
      workspaceId?: string;
      message?: string;
      changes?: Record<string, string | null>;
    };
    if (!(payload.workspaceId && payload.changes)) {
      return resultResponse({
        error: {
          message: "workspaceId and changes are required",
          details: [],
        },
        data: null,
      });
    }
    return resultResponse(
      await builderCommitFiles({
        workspaceId: payload.workspaceId,
        redis,
        message: payload.message,
        changes: payload.changes,
      })
    );
  })
  .post("/internal/deps-sync", async ({ body }) => {
    const payload = body as { workspaceId?: string };
    if (!payload.workspaceId) {
      return resultResponse({
        error: { message: "workspaceId is required", details: [] },
        data: null,
      });
    }
    return resultResponse(
      await builderDepsSync({
        workspaceId: payload.workspaceId,
        redis,
      })
    );
  })
  .post("/internal/publish", async ({ body }) => {
    const payload = body as { workspaceId?: string };
    if (!payload.workspaceId) {
      return resultResponse({
        error: { message: "workspaceId is required", details: [] },
        data: null,
      });
    }
    return resultResponse(
      await builderPublish({
        workspaceId: payload.workspaceId,
        redis,
      })
    );
  });

export function startBuilder() {
  builderApp.listen(env.PORT, ({ hostname, port }) => {
    logger.info({ host: hostname, port }, "templating-builder is running");
  });
}

export async function stopBuilder() {
  try {
    await builderApp.stop();
  } catch (error) {
    logger.error({ error }, "Error stopping templating-builder");
  }
  redis.close();
}
