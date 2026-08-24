import { describe, expect, spyOn, test } from "bun:test";
import openapi from "@elysia/openapi";
import { Elysia } from "elysia";
import * as z from "zod";
import { legacyApiKeyHeadersSchema } from "../routes/compat/send/validators";
import { sendEmailBodySchema } from "../routes/messages/validators/email";

const isTransformWarning = (arg: unknown) => {
  const message = arg instanceof Error ? arg.message : String(arg);
  return message.includes("Transforms cannot be represented in JSON Schema");
};

const transformWarningCalls = (warn: ReturnType<typeof spyOn>) =>
  warn.mock.calls.filter((args: readonly unknown[]) =>
    args.some(isTransformWarning)
  );

describe("OpenAPI Zod schemas", () => {
  test("send-email body documents wire From as a string", () => {
    const warn = spyOn(console, "warn");
    try {
      const schema = z.toJSONSchema(sendEmailBodySchema);
      expect(transformWarningCalls(warn)).toEqual([]);
      expect(schema).toMatchObject({
        properties: {
          from: { type: "string" },
          tags: {
            items: {
              properties: {
                name: { type: "string" },
                value: { type: "string" },
              },
            },
            type: "array",
          },
        },
        type: "object",
      });
    } finally {
      warn.mockRestore();
    }
  });

  test("spec generation does not warn on send schemas", async () => {
    const warn = spyOn(console, "warn");
    const app = new Elysia()
      .use(
        openapi({
          mapJsonSchema: {
            zod: z.toJSONSchema,
          },
          path: "/docs",
        })
      )
      .post("/messages/email", () => ({ id: "msg_test" }), {
        body: sendEmailBodySchema,
        headers: legacyApiKeyHeadersSchema,
      });

    try {
      const response = await app.handle(
        new Request("http://localhost/docs/json")
      );
      expect(response.status).toBe(200);
      expect(transformWarningCalls(warn)).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});
