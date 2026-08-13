import type { Schema } from "effect";

export type WebhookPayloadSchema = Schema.Codec<unknown, unknown, never, never>;

export interface WebhookEventDefinition<
  Type extends string,
  PayloadSchema extends WebhookPayloadSchema,
> {
  readonly payload: PayloadSchema;
  readonly type: Type;
}

export type WebhookEventInput<
  Definition extends WebhookEventDefinition<string, WebhookPayloadSchema>,
> =
  Definition extends WebhookEventDefinition<infer Type, infer PayloadSchema>
    ? {
        readonly data: PayloadSchema["Type"];
        readonly type: Type;
      }
    : never;

export const defineWebhookEvent = <
  const Type extends string,
  PayloadSchema extends WebhookPayloadSchema,
>(
  definition: WebhookEventDefinition<Type, PayloadSchema>
) => definition;
