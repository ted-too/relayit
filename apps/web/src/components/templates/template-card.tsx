import type { Template } from "@repo/shared/db/types";
import { Button } from "@repo/ui/components/base/button";
import { Card } from "@repo/ui/components/base/card";
import { Link, useParams } from "@tanstack/react-router";
import { MailIcon } from "lucide-react";

export function TemplateCard({ template }: { template: Template }) {
  const { projectSlug } = useParams({
    from: "/_authd/$projectSlug/templates/",
  });
  return (
    <Card className="flex flex-row items-center gap-3 px-4 py-3">
      <MailIcon className="size-4" />
      <div className="flex flex-col">
        <span className="font-semibold text-sm">{template.name}</span>
        <span className="text-muted-foreground text-xs">
          Created: {new Date(template.createdAt).toLocaleDateString()}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="ms-auto"
        render={
          <Link
            to="/$projectSlug/templates/$templateSlug"
            params={{
              projectSlug,
              templateSlug: template.slug,
            }}
          >
            Edit
          </Link>
        }
      />
    </Card>
  );
}
