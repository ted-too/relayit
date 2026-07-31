import { safeString } from "@repo/api/validators/shared";
import { z } from "zod";

export const createTopicBodySchema = z.object({
  name: safeString,
});

export type CreateTopicBody = z.infer<typeof createTopicBodySchema>;

export const topicIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type TopicIdParams = z.infer<typeof topicIdParamsSchema>;
