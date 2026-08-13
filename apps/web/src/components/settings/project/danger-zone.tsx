import { Alert, AlertTitle } from "@repo/ui/components/reui/alert";
import { Button } from "@repo/ui/components/ui/coss/button";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import {
  SettingsCard,
  SettingsCardContent,
  SettingsCardHeader,
  SettingsCardTitle,
} from "@/components/settings/card";
import { authClient } from "@/lib/auth-client";
import { queries } from "@/lib/queries";

export function ProjectDangerZone() {
  const navigate = useNavigate();
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const { data: organization } = useSuspenseQuery(
    queries.organizations.bySlug(orgSlug)
  );
  const { mutateAsync: deleteProject, isPending: isDeletingProject } =
    useMutation({
      mutationFn: async () => {
        const { error } = await authClient.organization.delete({
          organizationId: organization.id,
        });

        if (error) {
          return Promise.reject(error);
        }
      },
      onSuccess: (_, __, ___, { client }) => {
        client.invalidateQueries({
          queryKey: queries.organizations.queryKey,
        });
        navigate({ to: "/", reloadDocument: true });
      },
      onError: (error) => {
        toast.error("Failed to delete project", {
          description: error.message,
        });
      },
    });

  return (
    <SettingsCard className="bg-[color-mix(in_oklab,var(--destructive)_5%,var(--color-white))] ring-destructive-foreground">
      <SettingsCardHeader>
        <SettingsCardTitle className="text-destructive-foreground">
          Danger Zone
        </SettingsCardTitle>
      </SettingsCardHeader>
      <SettingsCardContent className="flex flex-col gap-6">
        {/* TODO: Any more actions to add? */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-medium">Delete Project</span>
            <p className="text-muted-foreground text-sm">
              Once you delete your project there is no going back. Please be
              certain.
            </p>
          </div>
          <ConfirmAction
            description="TODO: Add description saying this is irreversable etc"
            execute={deleteProject}
            isLoading={isDeletingProject}
            render={<Button className="w-16" variant="destructive" />}
            title="Delete user"
            verificationText={organization.slug}
          >
            Delete
          </ConfirmAction>
        </div>
        <Alert className="p-3 px-4" variant="default">
          <AlertTitle>
            To delete your account, head over to
            <Link className="ml-1.5 text-primary underline" to="/user/account">
              your account settings
            </Link>
          </AlertTitle>
        </Alert>
      </SettingsCardContent>
    </SettingsCard>
  );
}
