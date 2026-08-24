import { describe, expect, spyOn, test } from "bun:test";
import openapi from "@elysia/openapi";
import { Elysia } from "elysia";
import {
  sendEmailBodySchema,
  sendEmailHeadersSchema,
  sendEmailOpenApiModels,
} from "../routes/messages/validators/email";

const RESEND_COPY = /resend/i;

describe("OpenAPI send-email schemas", () => {
  test("documents Recipient as a named component union", async () => {
    const warn = spyOn(console, "warn");
    const app = new Elysia()
      .use(openapi({ path: "/docs" }))
      .model(sendEmailOpenApiModels)
      .post("/messages/email", () => ({ id: "msg_test" }), {
        body: sendEmailBodySchema,
        headers: sendEmailHeadersSchema,
      });

    try {
      const response = await app.handle(
        new Request("http://localhost/docs/json")
      );
      expect(response.status).toBe(200);
      expect(warn.mock.calls).toEqual([]);

      const spec = (await response.json()) as {
        components?: {
          schemas?: {
            Recipient?: { anyOf?: { title?: string }[] };
          };
        };
        paths?: Record<
          string,
          {
            post?: {
              requestBody?: {
                content?: {
                  "application/json"?: {
                    schema?: { properties?: { to?: { $ref?: string } } };
                  };
                };
              };
            };
          }
        >;
      };

      const path =
        spec.paths?.["/messages/email"] ?? spec.paths?.["/messages/email/"];
      expect(
        path?.post?.requestBody?.content?.["application/json"]?.schema
          ?.properties?.to
      ).toEqual({ $ref: "#/components/schemas/Recipient" });
      expect(spec.components?.schemas?.Recipient?.anyOf).toEqual([
        expect.objectContaining({ title: "Email address", type: "string" }),
        expect.objectContaining({ title: "Email addresses", type: "array" }),
        expect.objectContaining({ $ref: "#/components/schemas/Contact" }),
        expect.objectContaining({ title: "Contacts", type: "array" }),
      ]);
      expect(JSON.stringify(spec)).not.toMatch(RESEND_COPY);
    } finally {
      warn.mockRestore();
    }
  });
});
