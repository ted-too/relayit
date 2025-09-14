import { z } from "zod";

console.log(
  JSON.stringify(
    z.toJSONSchema(
      z.object({
        baseUrl: z.string(),
        userFirstname: z.string(),
      })
    ),
    null,
    2
  )
);
