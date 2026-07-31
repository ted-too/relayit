import { z } from "zod";

export const createUnsubscribeBodySchema = z
  .object({
    contactId: z.string().min(1),
    topicId: z.string().min(1).optional(),
    allMarketing: z.boolean().optional(),
  })
  .refine((body) => body.allMarketing === true || Boolean(body.topicId), {
    message: "Provide topicId or set allMarketing to true",
    path: ["topicId"],
  });

export type CreateUnsubscribeBody = z.infer<typeof createUnsubscribeBodySchema>;

export const deleteTopicUnsubscribeParamsSchema = z.object({
  contactId: z.string().min(1),
  topicId: z.string().min(1),
});

export type DeleteTopicUnsubscribeParams = z.infer<
  typeof deleteTopicUnsubscribeParamsSchema
>;

export const deleteGlobalUnsubscribeParamsSchema = z.object({
  contactId: z.string().min(1),
});

export type DeleteGlobalUnsubscribeParams = z.infer<
  typeof deleteGlobalUnsubscribeParamsSchema
>;
