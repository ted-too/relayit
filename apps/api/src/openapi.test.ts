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
      expect(document.components.schemas.Contact.additionalProperties).toBe(true);
      expect(
        document.components.schemas.Attachment.anyOf.map(
          (member: { additionalProperties: unknown }) => member.additionalProperties,
        ),
      ).toEqual([true, true]);
    }),
  );
});
