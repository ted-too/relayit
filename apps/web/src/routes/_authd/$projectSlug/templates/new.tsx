import {
  type ChannelContent,
  type CreateTemplateRequest,
  createTemplateSchema,
  emailTemplateEngineEnum,
} from "@repo/shared/forms";
import { AVAILABLE_TEMPLATE_CATEGORIES } from "@repo/shared/providers";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "@repo/ui/components/animate-ui/components/base/tabs";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/base/card";
import { useAppForm } from "@repo/ui/components/custom/form";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute("/_authd/$projectSlug/templates/new")({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { projectSlug } = Route.useParams();
  const { mutateAsync: createApiKey } = useMutation(
    trpc.templates.create.mutationOptions({
      onSuccess: async ({ slug }) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.templates.list.queryOptions().queryKey,
        });
        toast.success("Template created successfully");
        navigate({
          to: "/$projectSlug/templates/$templateSlug",
          params: {
            projectSlug,
            templateSlug: slug,
          },
        });
      },
      onError: (error) => {
        toast.error("Failed to create template", {
          description: error.message,
        });
      },
    })
  );

  const form = useAppForm({
    defaultValues: {
      name: "",
      slug: "",
      category: "transactional",
      schema: JSON.stringify({}),
      channelVersions: [
        {
          channel: "email",
          content: {
            engine: "react-email",
            subject: null as string | null,
            template: null as string | null,
          },
        },
      ],
    } as CreateTemplateRequest,
    validators: {
      onSubmit: createTemplateSchema,
    },
    onSubmit: async ({ value }) => await createApiKey(value),
    onSubmitInvalid: ({ formApi, value }) =>
      console.log(formApi.state.errors, value),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <Card className="mx-auto w-full max-w-6xl">
        <CardHeader>
          <CardTitle className="text-2xl">Create new template</CardTitle>
          <CardDescription>
            Design and customize message templates to deliver personalized
            notifications across your channels.
          </CardDescription>
          <CardAction>
            <form.AppForm>
              <form.SubmitButton className="w-full">Save</form.SubmitButton>
            </form.AppForm>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Name"
                  placeholder="e.g. Welcome"
                  className={{ root: "col-span-2" }}
                />
              )}
            </form.AppField>
            <form.AppField name="slug">
              {(field) => (
                <field.TextField
                  label="Slug"
                  placeholder="e.g., user.welcome"
                />
              )}
            </form.AppField>
            <form.AppField name="category">
              {(field) => (
                <field.MultiSelectField
                  label="Category"
                  multiple={false}
                  items={AVAILABLE_TEMPLATE_CATEGORIES.map((category) => ({
                    label: category,
                    value: category,
                  }))}
                />
              )}
            </form.AppField>
          </div>
          <form.AppField name="schema">
            {(field) => (
              <field.TextField
                label="Schema"
                placeholder="e.g. { name: string, email: string }"
                textarea
              />
            )}
          </form.AppField>
          <form.Field name="channelVersions" mode="array">
            {(field) => (
              <Tabs defaultValue="template">
                <TabsList className="w-full rounded-lg border">
                  <TabsTab value="template">Template</TabsTab>
                  <TabsTab value="preview">Preview</TabsTab>
                </TabsList>
                <TabsPanels>
                  <TabsPanel value="template">
                    <div className="grid gap-4">
                      {(field.state.value as ChannelContent[]).map((v, i) => {
                        const baseKey = `channelVersions[${i}]`;
                        switch (v.channel) {
                          case "email":
                            return (
                              <Fragment
                                key={`${v.channel}-${i}-channel-version`}
                              >
                                <form.AppField
                                  name={`${baseKey}.content.engine`}
                                >
                                  {(field) => (
                                    <field.MultiSelectField
                                      label="Engine"
                                      multiple={false}
                                      items={Object.entries(
                                        emailTemplateEngineEnum.enum
                                      ).map(([key, value]) => ({
                                        label: key,
                                        value,
                                      }))}
                                    />
                                  )}
                                </form.AppField>
                                <form.AppField
                                  name={`${baseKey}.content.subject`}
                                >
                                  {(field) => (
                                    <field.TextField
                                      label="Subject"
                                      placeholder="e.g. Welcome to our platform"
                                    />
                                  )}
                                </form.AppField>
                                <form.AppField
                                  name={`${baseKey}.content.template`}
                                >
                                  {(field) => (
                                    <field.TextField
                                      label="Template"
                                      textarea
                                    />
                                  )}
                                </form.AppField>
                              </Fragment>
                            );
                          default:
                            console.error(`Unknown channel: ${v.channel}`);
                            return null;
                        }
                      })}
                    </div>
                  </TabsPanel>
                  <TabsPanel value="preview">
                    Preview your template here.
                  </TabsPanel>
                </TabsPanels>
              </Tabs>
            )}
          </form.Field>
        </CardContent>
      </Card>
    </form>
  );
}
