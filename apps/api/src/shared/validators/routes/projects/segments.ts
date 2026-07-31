import { safeString } from "@repo/api/validators/shared";
import { z } from "zod";

export const createSegmentBodySchema = z.object({
  name: safeString,
});

export type CreateSegmentBody = z.infer<typeof createSegmentBodySchema>;

export const segmentIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type SegmentIdParams = z.infer<typeof segmentIdParamsSchema>;

export const addSegmentMembersBodySchema = z.object({
  contactIds: z.array(z.string().min(1)).min(1),
});

export type AddSegmentMembersBody = z.infer<typeof addSegmentMembersBodySchema>;

export const segmentMemberParamsSchema = z.object({
  id: z.string().min(1),
  contactId: z.string().min(1),
});

export type SegmentMemberParams = z.infer<typeof segmentMemberParamsSchema>;
