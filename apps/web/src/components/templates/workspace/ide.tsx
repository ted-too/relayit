import Editor from "@monaco-editor/react";
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiSaveLine,
} from "@remixicon/react";
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
import { cn } from "@repo/ui/lib/utils";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { queries } from "@/lib/queries";
import {
  commitWorkspaceFilesFn,
  depsSyncWorkspaceFn,
  getWorkspaceFn,
  previewWorkspaceEntryFn,
  publishWorkspaceFn,
  putReactEmailChannelFn,
  readWorkspaceFileFn,
} from "@/lib/templating/template.functions";
import {
  componentNameFromSlug,
  starterReactEmailEntrySource,
} from "./starter-entry";

const toastError = (error: unknown, fallback = "Something went wrong") => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : fallback;
  toast.error(fallback, { description: message });
};

const KIND = "reactEmail" as const;
const LEADING_SLASHES_RE = /^\/+/;
const REACT_EMAIL_PREFIX_RE = /^reactEmail\//;
const TSX_SUFFIX_RE = /\.tsx$/;

type EditorTab = "code" | "preview";

export interface WorkspaceIdeSearch {
  entryId?: string;
  intent?: "create-new" | "manage";
  templateId?: string;
}

function languageForPath(path: string) {
  if (path.endsWith(".tsx") || path.endsWith(".ts")) {
    return "typescript";
  }
  if (path.endsWith(".json")) {
    return "json";
  }
  if (path.endsWith(".css")) {
    return "css";
  }
  return "plaintext";
}

function buildTree(paths: readonly string[]) {
  const root: Record<string, unknown> = {};
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let cursor = root;
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1) {
        cursor[part] = filePath;
      } else {
        cursor[part] ??= {};
        cursor = cursor[part] as Record<string, unknown>;
      }
    }
  }
  return root;
}

export function WorkspaceIde({ search }: { search: WorkspaceIdeSearch }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activePath, setActivePath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [depsStatus, setDepsStatus] = useState<
    "idle" | "syncing" | "error" | "ok"
  >("idle");
  const [depsError, setDepsError] = useState<string | null>(null);
  const [propsJson, setPropsJson] = useState("{}");
  const [propsByPath, setPropsByPath] = useState<Record<string, string>>({});
  const propsByPathRef = useRef(propsByPath);
  propsByPathRef.current = propsByPath;
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("code");
  const [propsOpen, setPropsOpen] = useState(true);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState("reactEmail/");

  const filesQuery = useQuery(
    queries.organizations.bySlug(orgSlug).workspace(KIND).files
  );
  const entriesQuery = useQuery(
    queries.organizations.bySlug(orgSlug).workspace(KIND).entries
  );
  const templateQuery = useQuery({
    ...queries.organizations.bySlug(orgSlug).template(search.templateId ?? ""),
    enabled: Boolean(search.templateId),
  });

  const paths = filesQuery.data?.paths ?? [];
  const tree = useMemo(() => buildTree(paths), [paths]);

  const activeEntry = entriesQuery.data?.find(
    (entry) =>
      entry.id === search.entryId ||
      (activePath != null && entry.path === activePath)
  );

  const { mutateAsync: readFile } = useMutation({
    mutationFn: async (path: string) =>
      await readWorkspaceFileFn({
        data: { kind: KIND, orgSlug, path },
      }),
  });

  const { mutateAsync: commitFiles, isPending: isSaving } = useMutation({
    mutationFn: async (input: {
      changes: Record<string, string | null>;
      message?: string;
    }) =>
      await commitWorkspaceFilesFn({
        data: {
          changes: input.changes,
          kind: KIND,
          orgSlug,
          ...(input.message ? { message: input.message } : {}),
        },
      }),
  });

  const { mutateAsync: depsSync } = useMutation({
    mutationFn: async () =>
      await depsSyncWorkspaceFn({
        data: { kind: KIND, orgSlug },
      }),
  });

  const { mutateAsync: publish, isPending: isPublishing } = useMutation({
    mutationFn: async () =>
      await publishWorkspaceFn({
        data: { kind: KIND, orgSlug },
      }),
  });

  const { mutateAsync: preview, isPending: isPreviewing } = useMutation({
    mutationFn: async (input: {
      entryId: string;
      props: Record<string, unknown>;
      subject?: string;
    }) =>
      await previewWorkspaceEntryFn({
        data: {
          entryId: input.entryId,
          kind: KIND,
          orgSlug,
          props: input.props,
          ...(input.subject ? { subject: input.subject } : {}),
        },
      }),
  });

  const { mutateAsync: linkEntry } = useMutation({
    mutationFn: async (input: {
      templateId: string;
      workspaceEntryId: string;
      subject: string;
    }) =>
      await putReactEmailChannelFn({
        data: {
          orgSlug,
          subject: input.subject,
          templateId: input.templateId,
          workspaceEntryId: input.workspaceEntryId,
        },
      }),
  });

  // Soft-create workspace + optional create-new Entry from Template.slug.
  // Old API GET scaffolded Git before any commit; wait for that seed, then add
  // `reactEmail/<slug>.tsx` on top of package.json / welcome.tsx.
  useEffect(() => {
    if (bootstrapped || templateQuery.isLoading) {
      return;
    }
    if (search.intent === "create-new" && !templateQuery.data) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      try {
        await getWorkspaceFn({
          data: { kind: KIND, orgSlug },
        });
        const files = await queryClient.fetchQuery(
          queries.organizations.bySlug(orgSlug).workspace(KIND).files
        );

        if (search.intent === "create-new" && search.templateId) {
          const template = templateQuery.data;
          if (!template) {
            return;
          }
          const entryPath = `reactEmail/${template.slug}.tsx`;
          const exists = files.paths.includes(entryPath);
          if (!exists) {
            await commitFiles({
              message: `feat: add ${entryPath}`,
              changes: {
                [entryPath]: starterReactEmailEntrySource(
                  componentNameFromSlug(template.slug) || "Email"
                ),
              },
            });
            await queryClient.invalidateQueries({
              queryKey: queries.organizations.bySlug(orgSlug).workspace(KIND)
                .files.queryKey,
            });
            await queryClient.invalidateQueries({
              queryKey: queries.organizations.bySlug(orgSlug).workspace(KIND)
                .entries.queryKey,
            });
          }
          if (!cancelled) {
            setActivePath(entryPath);
          }
        } else if (search.entryId && entriesQuery.data) {
          const entry = entriesQuery.data.find(
            (row) => row.id === search.entryId
          );
          if (entry && !cancelled) {
            setActivePath(entry.path);
          }
        } else if (!cancelled && files.paths.length > 0) {
          const firstEntry =
            files.paths.find((path) => path.startsWith("reactEmail/")) ??
            files.paths[0];
          if (firstEntry) {
            setActivePath(firstEntry);
          }
        }
      } catch (error) {
        toastError(error as never);
      } finally {
        if (!cancelled) {
          setBootstrapped(true);
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    bootstrapped,
    commitFiles,
    entriesQuery.data,
    orgSlug,
    queryClient,
    search.entryId,
    search.intent,
    search.templateId,
    templateQuery.data,
    templateQuery.isLoading,
  ]);

  useEffect(() => {
    if (!activePath) {
      return;
    }
    // Seed from per-file cache; Entries with PreviewProps fill in on first Preview.
    setPropsJson(propsByPathRef.current[activePath] ?? "{}");
    setPreviewHtml(null);
    setPreviewSubject(null);
    setEditorTab("code");
    setPropsOpen(true);
  }, [activePath]);

  const templateEmailSubject = useMemo(() => {
    const emailContent = templateQuery.data?.channelVariants.find(
      (variant) => variant.channel === "email"
    )?.content;
    if (
      emailContent &&
      typeof emailContent === "object" &&
      "subject" in emailContent &&
      typeof emailContent.subject === "string" &&
      emailContent.subject.trim().length > 0
    ) {
      return emailContent.subject;
    }
    return templateQuery.data?.name ?? null;
  }, [templateQuery.data]);

  useEffect(() => {
    if (!activePath) {
      return;
    }
    let cancelled = false;
    void readFile(activePath)
      .then((file) => {
        if (!cancelled) {
          setDraft(file.content);
          setDirty(false);
        }
      })
      .catch((error) => {
        toastError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [activePath, readFile]);

  async function runDepsSync() {
    setDepsStatus("syncing");
    setDepsError(null);
    try {
      await depsSync();
      setDepsStatus("ok");
      await queryClient.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).workspace(KIND).files
          .queryKey,
      });
    } catch (error) {
      setDepsStatus("error");
      const message =
        error instanceof Error ? error.message : "Deps sync failed";
      setDepsError(message);
      toastError(error, "Deps sync failed");
    }
  }

  async function handleSave() {
    if (!activePath) {
      return;
    }
    try {
      await commitFiles({
        message: `chore: update ${activePath}`,
        changes: { [activePath]: draft },
      });
      setDirty(false);
      toast.success("Saved to draft (dev)");
      await queryClient.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).workspace(KIND).files
          .queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).workspace(KIND).entries
          .queryKey,
      });
      if (activePath === "package.json") {
        await runDepsSync();
      }
    } catch (error) {
      toastError(error as never);
    }
  }

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useHotkey(
    "Mod+S",
    () => {
      void handleSaveRef.current();
    },
    {
      preventDefault: true,
      enabled: Boolean(activePath),
    }
  );

  async function handlePreview() {
    const entry =
      activeEntry ?? entriesQuery.data?.find((row) => row.path === activePath);
    if (!entry) {
      toast.error("Save an Entry file first, then Preview");
      return;
    }
    setEditorTab("preview");
    if (dirty) {
      await handleSave();
    }
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(propsJson) as Record<string, unknown>;
    } catch {
      toast.error("Props JSON is invalid");
      setEditorTab("code");
      return;
    }
    try {
      // Subject comes from the Template channel; preview only renders HTML + shows it as chrome.
      // Empty props merge with Entry `Component.PreviewProps` on the server.
      const result = await preview({
        entryId: entry.id,
        props,
        subject: templateEmailSubject?.trim() || "Preview",
      });
      setPreviewHtml(result.html);
      setPreviewSubject(result.subject);
      if (result.propsJson && activePath) {
        let nextJson = result.propsJson;
        try {
          nextJson = `${JSON.stringify(JSON.parse(result.propsJson), null, 2)}\n`;
        } catch {
          nextJson = result.propsJson;
        }
        setPropsJson(nextJson);
        setPropsByPath((prev) => ({ ...prev, [activePath]: nextJson }));
        setPropsOpen(false);
      }
    } catch (error) {
      toastError(error as never);
    }
  }

  async function handlePublish() {
    if (depsStatus === "syncing") {
      toast.error("Wait for dependency sync to finish");
      return;
    }
    if (depsStatus === "error") {
      toast.error("Fix dependency sync before Publish", {
        description: depsError ?? undefined,
      });
      return;
    }
    if (dirty) {
      await handleSave();
    }
    try {
      const result = await publish();
      await queryClient.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).workspace(KIND).entries
          .queryKey,
      });

      if (search.intent === "create-new" && search.templateId) {
        const publishedEntry =
          result.entries.find((entry) => entry.path === activePath) ??
          result.entries[0];
        if (publishedEntry) {
          await linkEntry({
            templateId: search.templateId,
            workspaceEntryId: publishedEntry.id,
            subject: templateEmailSubject?.trim() || "Untitled",
          });
          await queryClient.invalidateQueries({
            queryKey:
              queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
          });
          await queryClient.invalidateQueries({
            queryKey: queries.organizations
              .bySlug(orgSlug)
              .template(search.templateId).queryKey,
          });
          toast.success("Published and linked");
          void navigate({
            to: "/$orgSlug/automations/templates/$templateId",
            params: { orgSlug, templateId: search.templateId },
          });
          return;
        }
      }

      toast.success("Published successfully");
    } catch (error) {
      toastError(error as never);
    }
  }

  const publishBlocked = depsStatus === "syncing" || depsStatus === "error";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-medium text-xl">Email Workspace</h1>
          {depsStatus === "syncing" ? (
            <Badge variant="secondary">
              <RiLoader4Line className="animate-spin" />
              Updating dependencies…
            </Badge>
          ) : null}
          {depsStatus === "ok" ? (
            <Badge variant="secondary">
              <RiCheckLine />
              Dependencies up to date
            </Badge>
          ) : null}
          {depsStatus === "error" ? (
            <Badge variant="destructive">
              <RiErrorWarningLine />
              Deps sync failed
            </Badge>
          ) : null}
          {dirty ? <Badge variant="outline">Unsaved</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {search.templateId ? (
            <Button
              render={
                <Link
                  params={{ orgSlug, templateId: search.templateId }}
                  to="/$orgSlug/automations/templates/$templateId"
                />
              }
              variant="outline"
            >
              Back to Template
            </Button>
          ) : (
            <Button
              render={
                <Link
                  params={{ orgSlug }}
                  to="/$orgSlug/automations/templates"
                />
              }
              variant="outline"
            >
              Back to Templates
            </Button>
          )}
          <Button
            disabled={!activePath || isSaving}
            onClick={() => void handleSave()}
            variant="outline"
          >
            <RiSaveLine />
            Save
          </Button>
          <Button
            disabled={!activePath || isPreviewing}
            onClick={() => void handlePreview()}
            variant="outline"
          >
            Preview
          </Button>
          <Button
            disabled={publishBlocked || isPublishing}
            onClick={() => void handlePublish()}
          >
            Publish
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] gap-3">
        <aside className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg border bg-card p-2 text-sm">
          <Button
            className="w-full"
            onClick={() => {
              setNewFilePath("reactEmail/");
              setNewFileOpen(true);
            }}
            size="sm"
            variant="outline"
          >
            New file
          </Button>
          <div className="min-h-0 flex-1 overflow-auto">
            <FileTree
              activePath={activePath}
              node={tree}
              onSelect={setActivePath}
            />
          </div>
        </aside>

        <Dialog onOpenChange={setNewFileOpen} open={newFileOpen}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>New file</DialogTitle>
              <DialogDescription>
                Path within the Email Workspace (e.g. reactEmail/receipt.tsx).
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Input
                onChange={(event) => setNewFilePath(event.target.value)}
                placeholder="reactEmail/receipt.tsx"
                value={newFilePath}
              />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                Cancel
              </DialogClose>
              <Button
                onClick={() => {
                  const next = newFilePath
                    .trim()
                    .replace(LEADING_SLASHES_RE, "");
                  if (!next) {
                    return;
                  }
                  if (next === "bun.lock" || next === "bun.lockb") {
                    toast.error("Lockfile is platform-owned");
                    return;
                  }
                  const slugStem = next
                    .replace(REACT_EMAIL_PREFIX_RE, "")
                    .replace(TSX_SUFFIX_RE, "");
                  const content = next.endsWith(".tsx")
                    ? starterReactEmailEntrySource(
                        componentNameFromSlug(slugStem) || "Email"
                      )
                    : next.endsWith(".json")
                      ? "{}\n"
                      : "";
                  void commitFiles({
                    message: `feat: add ${next}`,
                    changes: { [next]: content },
                  })
                    .then(async () => {
                      await queryClient.invalidateQueries({
                        queryKey: queries.organizations
                          .bySlug(orgSlug)
                          .workspace(KIND).files.queryKey,
                      });
                      await queryClient.invalidateQueries({
                        queryKey: queries.organizations
                          .bySlug(orgSlug)
                          .workspace(KIND).entries.queryKey,
                      });
                      setActivePath(next);
                      setNewFileOpen(false);
                      toast.success("File created");
                    })
                    .catch((error) => {
                      toastError(error as never);
                    });
                }}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-1.5">
            <div className="min-w-0 truncate font-mono text-muted-foreground text-xs">
              {activePath ?? "No file selected"}
              {activePath === "bun.lock" ? " · read-only" : null}
            </div>
            <div
              className="flex shrink-0 rounded-md border bg-muted/40 p-0.5"
              role="tablist"
            >
              <button
                className={cn(
                  "rounded px-2.5 py-1 font-medium text-xs transition-colors",
                  editorTab === "code"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setEditorTab("code")}
                role="tab"
                type="button"
              >
                Code
              </button>
              <button
                className={cn(
                  "rounded px-2.5 py-1 font-medium text-xs transition-colors",
                  editorTab === "preview"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                disabled={!activePath}
                onClick={() => {
                  setEditorTab("preview");
                  if (previewHtml || isPreviewing) {
                    return;
                  }
                  void handlePreview();
                }}
                role="tab"
                type="button"
              >
                Preview
              </button>
            </div>
          </div>

          {editorTab === "code" ? (
            <div className="min-h-0 flex-1">
              {activePath ? (
                <Editor
                  height="100%"
                  language={languageForPath(activePath)}
                  onChange={(value) => {
                    if (activePath === "bun.lock") {
                      return;
                    }
                    setDraft(value ?? "");
                    setDirty(true);
                  }}
                  onMount={(editor, monaco) => {
                    editor.addCommand(
                      // Monaco keybindings are bitflags.
                      // biome-ignore lint/suspicious/noBitwiseOperators: Monaco KeyMod API
                      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                      () => {
                        void handleSaveRef.current();
                      }
                    );
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    readOnly: activePath === "bun.lock",
                    wordWrap: "on",
                  }}
                  path={activePath}
                  theme="vs-dark"
                  value={draft}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                  Select a file
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col bg-[hsl(0,0%,96%)]">
              <div className="border-b bg-background px-4 py-3">
                <div className="text-muted-foreground text-xs uppercase tracking-wide">
                  Subject
                </div>
                <div className="mt-0.5 truncate font-medium text-sm">
                  {previewSubject ??
                    templateEmailSubject ??
                    "Run Preview to resolve subject"}
                </div>
              </div>

              <div className="border-b bg-background">
                <button
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-muted/50"
                  onClick={() => setPropsOpen((open) => !open)}
                  type="button"
                >
                  <span className="font-medium">Props</span>
                  <span className="flex items-center gap-2 text-muted-foreground text-xs">
                    Empty uses Entry PreviewProps
                    {propsOpen ? <RiArrowUpSLine /> : <RiArrowDownSLine />}
                  </span>
                </button>
                {propsOpen ? (
                  <div className="flex flex-col gap-2 border-t px-4 py-3">
                    <textarea
                      className="min-h-36 resize-y rounded-md border bg-background p-2 font-mono text-xs"
                      onChange={(event) => {
                        const next = event.target.value;
                        setPropsJson(next);
                        if (activePath) {
                          setPropsByPath((prev) => ({
                            ...prev,
                            [activePath]: next,
                          }));
                        }
                      }}
                      placeholder="{}"
                      spellCheck={false}
                      value={propsJson}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-muted-foreground text-xs">
                        Overrides{" "}
                        <code className="font-mono">PreviewProps</code> for this
                        file.
                      </p>
                      <Button
                        disabled={!activePath || isPreviewing}
                        onClick={() => void handlePreview()}
                        size="sm"
                        variant="outline"
                      >
                        {isPreviewing ? (
                          <>
                            <RiLoader4Line className="animate-spin" />
                            Rendering…
                          </>
                        ) : (
                          "Refresh preview"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative min-h-0 flex-1 p-4">
                <div className="absolute inset-4 mx-auto max-w-3xl overflow-hidden rounded-lg border bg-white shadow-sm">
                  {isPreviewing ? (
                    <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
                      <RiLoader4Line className="animate-spin" />
                      Rendering draft…
                    </div>
                  ) : previewHtml ? (
                    <iframe
                      className="size-full border-0"
                      sandbox=""
                      srcDoc={previewHtml}
                      title="Email preview"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="text-muted-foreground text-sm">
                        Preview renders the current draft (does not go live).
                      </p>
                      <Button
                        disabled={!activePath || isPreviewing}
                        onClick={() => void handlePreview()}
                      >
                        Run Preview
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FileTree({
  node,
  activePath,
  onSelect,
  prefix = "",
}: {
  node: Record<string, unknown>;
  activePath: string | null;
  onSelect: (path: string) => void;
  prefix?: string;
}) {
  const entries = Object.entries(node).sort(([a], [b]) => a.localeCompare(b));

  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([name, value]) => {
        if (typeof value === "string") {
          const selected = activePath === value;
          return (
            <li key={value}>
              <button
                className={`w-full rounded px-2 py-1 text-left hover:bg-muted ${
                  selected ? "bg-muted font-medium" : ""
                }`}
                onClick={() => onSelect(value)}
                type="button"
              >
                {name}
              </button>
            </li>
          );
        }
        return (
          <li key={`${prefix}${name}`}>
            <div className="px-2 py-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {name}
            </div>
            <div className="pl-2">
              <FileTree
                activePath={activePath}
                node={value as Record<string, unknown>}
                onSelect={onSelect}
                prefix={`${prefix}${name}/`}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
