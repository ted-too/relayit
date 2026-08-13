import * as z from "zod";

export const contactPropertiesSchema = z.record(z.string(), z.string());

export type ContactProperties = z.infer<typeof contactPropertiesSchema>;
