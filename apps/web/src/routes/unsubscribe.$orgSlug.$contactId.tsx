import { Button } from "@repo/ui/components/ui/coss/button";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { API_ORIGIN } from "@/lib/api-origin";

const unsubscribeSearchSchema = z.object({
  msg: z.string().optional(),
  sig: z.string().optional(),
  topic: z.string().optional(),
});

// Where the api sends a person who opens a `List-Unsubscribe` link. Opening it changes
// nothing, since link scanners open every URL in a message: confirming sends the same
// one-click POST a mailbox provider does (`apps/api/src/routes/unsubscribe.ts`).
export const Route = createFileRoute("/unsubscribe/$orgSlug/$contactId")({
  validateSearch: unsubscribeSearchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const { contactId, orgSlug } = Route.useParams();
  const { msg = "", sig = "", topic = "" } = Route.useSearch();

  const { error, isPending, isSuccess, mutate } = useMutation({
    mutationFn: async () => {
      const query = new URLSearchParams({ msg, sig, topic });
      const response = await fetch(
        `${API_ORIGIN}/unsubscribe/${encodeURIComponent(orgSlug)}/${encodeURIComponent(contactId)}?${query}`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Something went wrong.");
      }
    },
  });

  return (
    <main className="m-auto flex max-w-sm flex-col gap-4 p-6 text-center">
      {isSuccess ? (
        <p>You are unsubscribed. You won't get these emails any more.</p>
      ) : (
        <>
          <p>Stop getting these emails?</p>
          <Button disabled={isPending} onClick={() => mutate()}>
            Unsubscribe
          </Button>
          {error && <p className="text-destructive text-sm">{error.message}</p>}
        </>
      )}
    </main>
  );
}
