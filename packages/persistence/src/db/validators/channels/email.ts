import * as z from "zod";

export const emailAddressListSchema = z.array(z.string());
export type EmailAddressList = z.infer<typeof emailAddressListSchema>;

export const emailFromSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  normalized: z.string(),
});
export type EmailFrom = z.infer<typeof emailFromSchema>;

export const emailHeadersSchema = z.record(z.string(), z.string());
export type EmailHeaders = z.infer<typeof emailHeadersSchema>;
