import {
  type ChannelContent,
  emailTemplateEngineEnum,
  type UpdateTemplateRequest,
  updateTemplateSchema,
} from "@repo/shared/forms";
import {
  AVAILABLE_TEMPLATE_CATEGORIES,
  AVAILABLE_TEMPLATE_STATUSES,
} from "@repo/shared/providers";
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
import { useStore } from "@tanstack/react-form";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Fragment } from "react";
import { EmailPreview } from "@/components/templates/preview";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute(
  "/_authd/$projectSlug/templates/$templateSlug"
)({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(
        context.trpc.templates.getBySlug.queryOptions({
          slug: params.templateSlug,
        })
      );
    } catch (_error) {
      throw notFound();
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const { templateSlug } = Route.useParams();
  const { data } = useSuspenseQuery(
    trpc.templates.getBySlug.queryOptions({
      slug: templateSlug,
    })
  );
  const queryClient = useQueryClient();
  const { mutateAsync: updateTemplate } = useMutation(
    trpc.templates.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.templates.list.queryOptions().queryKey,
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.templates.getBySlug.queryOptions({
            slug: templateSlug,
          }).queryKey,
        });
        toast.success("Template updated successfully");
      },
      onError: (error) => {
        toast.error("Failed to update template", {
          description: error.message,
        });
      },
    })
  );

  const form = useAppForm({
    defaultValues: {
      id: data.id,
      status: data.status,
      name: data.name,
      slug: data.slug,
      category: data.category,
      schema: data.currentVersion.schema
        ? JSON.stringify(data.currentVersion.schema, null, 2)
        : undefined,
      channelVersions: data.currentVersion.channelVersions.map((v) => ({
        channel: v.channel,
        content: v.content,
      })),
    } as UpdateTemplateRequest,
    validators: {
      // @ts-expect-error - FIXME: we need to fix this
      onSubmit: updateTemplateSchema,
    },
    onSubmit: async ({ value }) => await updateTemplate(value),
  });

  const isPristine = useStore(form.store, (state) => state.isPristine);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <Card className="mx-auto w-full max-w-6xl">
        <CardHeader className="grow">
          <CardTitle className="text-2xl">{data.name}</CardTitle>
          <CardDescription>
            Status: <strong>{data.status}</strong> Last updated:{" "}
            <strong>
              {new Date(data.currentVersion.createdAt).toISOString()}
            </strong>{" "}
            {new Date(data.createdAt).getTime() !==
              new Date(data.currentVersion.createdAt).getTime() && (
              <>
                Created:{" "}
                <strong>{new Date(data.createdAt).toISOString()}</strong>
              </>
            )}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-4">
              <form.AppField name="status">
                {(field) => (
                  <field.SelectField
                    multiple={false}
                    label="Status"
                    items={AVAILABLE_TEMPLATE_STATUSES.map((status) => ({
                      label: status,
                      value: status,
                    }))}
                    className={{ label: "sr-only", root: "w-24" }}
                  />
                )}
              </form.AppField>
              <form.AppForm>
                <form.SubmitButton disabled={isPristine} className="w-32">
                  Update
                </form.SubmitButton>
              </form.AppForm>
            </div>
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
                <field.SelectField
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
                className={{ input: "h-96 overflow-y-auto" }}
                textarea
              />
            )}
          </form.AppField>
          <form.Field name="channelVersions" mode="array">
            {(field) =>
              (field.state.value as ChannelContent[]).map((v, i) => {
                const baseKey = `channelVersions[${i}]`;
                let TemplateFormComponent: React.ReactNode = null;

                switch (v.channel) {
                  case "email":
                    TemplateFormComponent = (
                      <Fragment key={`${v.channel}-${i}-channel-version`}>
                        <form.AppField name={`${baseKey}.content.engine`}>
                          {(field) => (
                            <field.SelectField
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
                        <form.AppField name={`${baseKey}.content.subject`}>
                          {(field) => (
                            <field.TextField
                              label="Subject"
                              placeholder="e.g. Welcome to our platform"
                            />
                          )}
                        </form.AppField>
                        <form.AppField name={`${baseKey}.content.template`}>
                          {(field) => (
                            <field.TextField
                              label="Template"
                              className={{ input: "h-96 overflow-y-auto" }}
                              textarea
                            />
                          )}
                        </form.AppField>
                      </Fragment>
                    );
                    break;
                  default:
                    console.error(`Unknown channel: ${v.channel}`);
                }

                return (
                  <Tabs
                    defaultValue="template"
                    key={`${v.channel}-${i}-channel-version`}
                    className="gap-4"
                  >
                    <TabsList className="w-full rounded-lg border">
                      <TabsTab value="template">Template</TabsTab>
                      <TabsTab value="preview">Preview</TabsTab>
                    </TabsList>
                    <TabsPanels>
                      <TabsPanel value="template">
                        <div className="grid gap-4">
                          {TemplateFormComponent}
                        </div>
                      </TabsPanel>
                      <TabsPanel value="preview">
                        <form.Subscribe
                          selector={(state) =>
                            state.values.channelVersions?.[i]?.content
                          }
                        >
                          {(content) =>
                            content ? (
                              <EmailPreview
                                template={content}
                                // TODO: Allow this to be set by the user
                                previewData={undefined}
                              />
                            ) : null
                          }
                        </form.Subscribe>
                      </TabsPanel>
                    </TabsPanels>
                  </Tabs>
                );
              })
            }
          </form.Field>
        </CardContent>
      </Card>
    </form>
  );
}
