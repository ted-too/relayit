/**
 * CLI entry for a short-lived render isolate process.
 * Args: <artifactPath> <propsJson> <subject>
 * Env: RELAYIT_MERGE_PREVIEW_PROPS=1 → merge default.PreviewProps under caller props
 *      (preview only; never for send).
 * Prints a single JSON line to stdout.
 *
 * Subject is supplied by the caller (Template variant / request override) —
 * Entry source does not export subject.
 */
import { render } from "@react-email/render";
import { type ComponentType, createElement } from "react";

type Result =
  | {
      ok: true;
      value: {
        html: string;
        text?: string;
        subject: string;
        props: Record<string, unknown>;
      };
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

type EmailComponent = ComponentType<Record<string, unknown>> & {
  PreviewProps?: Record<string, unknown>;
};

const SSR_ERROR_MSG_RE = /data-msg="([^"]*)"/;

function readPreviewProps(component: EmailComponent): Record<string, unknown> {
  const previewProps = component.PreviewProps;
  if (
    previewProps &&
    typeof previewProps === "object" &&
    !Array.isArray(previewProps)
  ) {
    return previewProps;
  }
  return {};
}

async function main() {
  const artifactPath = process.argv[2];
  const propsJson = process.argv[3] ?? "{}";
  const subject = process.argv[4];
  const mergePreviewProps = process.env.RELAYIT_MERGE_PREVIEW_PROPS === "1";

  if (!artifactPath) {
    write({
      ok: false,
      error: { code: "invalid_artifact", message: "Missing artifact path" },
    });
    process.exit(1);
  }

  if (subject == null || subject.length === 0) {
    write({
      ok: false,
      error: {
        code: "missing_subject",
        message:
          "reactEmail render requires a subject from the Template variant or request.",
      },
    });
    process.exit(1);
  }

  try {
    const callerProps = JSON.parse(propsJson) as Record<string, unknown>;
    const mod = (await import(artifactPath)) as {
      default?: EmailComponent;
    };

    if (typeof mod.default !== "function") {
      write({
        ok: false,
        error: {
          code: "missing_default_export",
          message: "Sealed artifact has no default React component export.",
        },
      });
      process.exit(1);
    }

    const defaults = mergePreviewProps ? readPreviewProps(mod.default) : {};
    const props = { ...defaults, ...callerProps };

    const element = createElement(mod.default, props);
    const html = await render(element);
    const text = await render(element, { plainText: true });

    // React 19 may recover into an error <template> instead of throwing.
    if (html.includes("Switched to client rendering because the server rendering errored")) {
      const match = html.match(SSR_ERROR_MSG_RE);
      const detail = match?.[1]
        ? match[1]
            .replaceAll("&#x27;", "'")
            .replaceAll("&quot;", '"')
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&amp;", "&")
        : "React Email render failed";
      write({
        ok: false,
        error: { code: "render_failed", message: detail },
      });
      process.exit(1);
    }

    write({ ok: true, value: { html, text, subject, props } });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error);

    write({
      ok: false,
      error: {
        code: "render_failed",
        message: message || "Sealed artifact render failed",
      },
    });
    process.exit(1);
  }
}

function write(result: Result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main();
