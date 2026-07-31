import { safeString } from "@repo/api/validators/shared";
import { z } from "zod";

export const createCampaignBodySchema = z.object({
  name: safeString,
  topicId: z.string().min(1),
  templateId: z.string().min(1),
});

export type CreateCampaignBody = z.infer<typeof createCampaignBodySchema>;

export const patchCampaignBodySchema = z
  .object({
    name: safeString.optional(),
    topicId: z.string().min(1).optional(),
    templateId: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.topicId !== undefined ||
      body.templateId !== undefined,
    { message: "At least one of name, topicId, or templateId is required" }
  );

export type PatchCampaignBody = z.infer<typeof patchCampaignBodySchema>;

export const campaignIdParamsSchema = z.object({
  id: z.string().min(1),
});

export type CampaignIdParams = z.infer<typeof campaignIdParamsSchema>;

/** Email From: plain address or { name, address }; normalized for storage. */
export const campaignEmailFromSchema = z
  .union([z.email(), z.object({ name: z.string(), address: z.email() })])
  .transform((val) => {
    if (typeof val === "string") {
      return { address: val, normalized: val };
    }

    let fullAddress: string = val.address;
    let escapedName: string | undefined;
    if (val.name) {
      escapedName = val.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      fullAddress = `"${escapedName}" <${val.address}>`;
    }

    return { name: escapedName, address: val.address, normalized: fullAddress };
  });

export type CampaignEmailFromBody = z.infer<typeof campaignEmailFromSchema>;

export const putCampaignEmailChannelBodySchema = z.object({
  from: campaignEmailFromSchema,
});

export type PutCampaignEmailChannelBody = z.infer<
  typeof putCampaignEmailChannelBodySchema
>;
