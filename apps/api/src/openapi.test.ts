import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { request, serve, stubs } from "./testing";

describe("/openapi.json", () => {
  it.live("documents the public routes only, not the dashboard's or better-auth's", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const document = JSON.parse((yield* request(origin, "GET", "/openapi.json")).body) as {
        readonly paths: Record<string, unknown>;
      };
      expect(Object.keys(document.paths).sort()).toEqual([
        "/messages/email",
        "/send/{project}/raw/email",
        "/send/{project}/template/email",
      ]);
    }),
  );

  it.live("says /messages/email refuses topic_id and takes any other field it does not know", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const document = JSON.parse((yield* request(origin, "GET", "/openapi.json")).body);
      const body =
        document.paths["/messages/email"].post.requestBody.content["application/json"].schema;

      expect(body.properties.topic_id).toMatchObject({ not: {} });
      expect(body.additionalProperties).toBe(true);
      expect(body.properties.template.additionalProperties).toBe(true);
      expect(body.properties.tags.items.additionalProperties).toBe(true);
      expect(document.components.schemas.Contact.additionalProperties).toBe(true);
      // And no object the body reaches, through any `$ref`, is declared closed.
      const closed: string[] = [];
      const seen = new Set<unknown>();
      const walk = (schema: unknown, path: string): void => {
        if (typeof schema !== "object" || schema === null || seen.has(schema)) {
          return;
        }
        seen.add(schema);
        if ("additionalProperties" in schema && schema.additionalProperties === false) {
          closed.push(path);
        }
        if ("$ref" in schema && typeof schema.$ref === "string") {
          const name = schema.$ref.replace("#/components/schemas/", "");
          walk(document.components.schemas[name], name);
        }
        for (const [key, value] of Object.entries(schema)) {
          walk(value, `${path}/${key}`);
        }
      };
      walk(body, "body");
      expect(closed).toEqual([]);
      expect(seen.has(document.components.schemas.Attachment.anyOf[0])).toBe(true);

      // The legacy endpoints' objects are as the generator declares them.
      expect(
        document.paths["/send/{project}/raw/email"].post.requestBody.content["application/json"]
          .schema.additionalProperties,
      ).toBe(false);
    }),
  );
});
