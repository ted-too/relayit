import z from "zod";
import { authdProcedure, router } from ".";

export const chatRouter = router({
  send: authdProcedure
    .input(
      z.object({
        message: z.string(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { message } = input;
      return {
        message,
      };
    }),
});
