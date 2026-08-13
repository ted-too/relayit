import { RiAddLine, RiCodeBoxLine, RiLinkM } from "@remixicon/react";
import { Badge } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/ui/coss/dialog";
import { Input } from "@repo/ui/components/ui/shad/input";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { queries } from "@/lib/queries";
import { putReactEmailChannelFn } from "@/lib/templating/template.functions";
import type { WorkspaceEntryListItem } from "@/lib/templating/workspace";
import type { Template } from "./types";

function emailVariantOf(template: Template) {
  return template.channelVariants.find(
    (variant) => variant.channel === "email"
  );
}

function subjectFromVariant(template: Template) {
  const variant = emailVariantOf(template);
  const content = variant?.content;
  if (
    content &&
    typeof content === "object" &&
    "subject" in content &&
    typeof content.subject === "string"
  ) {
    return content.subject;
  }
  return "";
}

export function TemplateEmailChannel({ template }: { template: Template }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [subject, setSubject] = useState(
    () => subjectFromVariant(template) || template.name
  );

  useEffect(() => {
    const next = subjectFromVariant(template);
    if (next) {
      setSubject(next);
    }
  }, [template]);

  const { data: entries } = useSuspenseQuery(
    queries.organizations.bySlug(orgSlug).workspace("reactEmail").entries
  );

  const emailVariant = emailVariantOf(template);
  const linkedEntry = entries.find(
    (entry) => entry.id === emailVariant?.workspaceEntryId
  );
  const pickableEntries = entries.filter((entry) => entry.pickable);

  const { mutate: linkEntry, isPending: isLinking } = useMutation({
    mutationFn: async (input: { workspaceEntryId: string; subject: string }) =>
      await putReactEmailChannelFn({
        data: {
          orgSlug,
          subject: input.subject,
          templateId: template.id,
          workspaceEntryId: input.workspaceEntryId,
        },
      }),
    onSuccess: async (_, __, ___, { client }) => {
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
      });
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).template(template.id)
          .queryKey,
      });
      toast.success("Email channel saved");
      setPickerOpen(false);
    },
    onError: (error: Error) => {
      toast.error("Failed to save email channel", {
        description: error.message,
      });
    },
  });

  if (template.archivedAt) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-lg">Email channel</h2>
        <p className="text-muted-foreground text-sm">
          This Template is archived. Unarchive is not available — create a new
          Template to send again.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-lg">Email channel</h2>
          <p className="text-muted-foreground text-sm">
            Set the email subject on this Template, then link a published React
            Email Workspace Entry. Drafts are not sendable until Publish
            succeeds.
          </p>
        </div>
        {emailVariant?.broken ? (
          <Badge variant="destructive">Broken</Badge>
        ) : emailVariant?.workspaceEntryId ? (
          <Badge variant="secondary">Linked</Badge>
        ) : (
          <Badge variant="outline">Not linked</Badge>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-sm" htmlFor="template-email-subject">
          Subject
        </label>
        <Input
          id="template-email-subject"
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Welcome to Tsavaro!"
          value={subject}
        />
        <p className="text-muted-foreground text-xs">
          Lives on the Template — not in the React Email Entry source. Send
          requests may still override it.
        </p>
      </div>

      {linkedEntry ? (
        <div className="flex flex-col gap-2 rounded-md border bg-background p-4">
          <div className="font-medium text-sm">{linkedEntry.path}</div>
          <div className="text-muted-foreground text-xs">
            {linkedEntry.pickable
              ? "Pickable — last successful Publish is live for sends"
              : "Not pickable — Publish the Email Workspace first"}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No Workspace Entry linked yet.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {linkedEntry ? (
          <Button
            disabled={isLinking || subject.trim().length === 0}
            onClick={() =>
              linkEntry({
                workspaceEntryId: linkedEntry.id,
                subject: subject.trim(),
              })
            }
            variant="outline"
          >
            Save subject
          </Button>
        ) : null}
        <Button
          disabled={subject.trim().length === 0}
          onClick={() => setPickerOpen(true)}
          variant="outline"
        >
          <RiLinkM />
          {emailVariant?.workspaceEntryId ? "Change Entry" : "Pick Entry"}
        </Button>
        {linkedEntry ? (
          <Button
            render={
              <Link
                params={{ orgSlug }}
                search={{
                  templateId: template.id,
                  entryId: linkedEntry.id,
                  intent: "manage",
                }}
                to="/$orgSlug/automations/templates/workspace"
              />
            }
            variant="outline"
          >
            <RiCodeBoxLine />
            Open in editor
          </Button>
        ) : null}
        <Button
          render={
            <Link
              params={{ orgSlug }}
              search={{
                templateId: template.id,
                intent: "create-new",
              }}
              to="/$orgSlug/automations/templates/workspace"
            />
          }
        >
          <RiAddLine />
          Create new Entry
        </Button>
      </div>

      <EntryPickerDialog
        entries={pickableEntries}
        isLinking={isLinking}
        onLink={(entry) =>
          linkEntry({
            workspaceEntryId: entry.id,
            subject: subject.trim(),
          })
        }
        onOpenChange={setPickerOpen}
        open={pickerOpen}
        subject={subject}
      />
    </section>
  );
}

function EntryPickerDialog({
  open,
  onOpenChange,
  entries,
  onLink,
  isLinking,
  subject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: WorkspaceEntryListItem[];
  onLink: (entry: WorkspaceEntryListItem) => void;
  isLinking: boolean;
  subject: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Pick a Workspace Entry</DialogTitle>
          <DialogDescription>
            Only Entries with a successful Publish are listed. Subject for this
            Template: {subject.trim() || "(required above)"}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-2">
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pickable Entries yet. Create a new Entry and Publish it first.
            </p>
          ) : (
            entries.map((entry) => (
              <button
                className="flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                disabled={isLinking || subject.trim().length === 0}
                key={entry.id}
                onClick={() => onLink(entry)}
                type="button"
              >
                <span>{entry.path}</span>
                <Badge size="sm" variant="secondary">
                  Pickable
                </Badge>
              </button>
            ))
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
