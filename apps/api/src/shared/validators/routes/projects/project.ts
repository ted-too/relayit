import { safeString } from "@repo/api/validators/shared";
import { z } from "zod";

/** Body for POST /projects — name only; slug is generated server-side. */
export const createProjectBodySchema = z.object({
  name: safeString,
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
