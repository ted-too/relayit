/**
 * CLI entry for a short-lived render isolate process.
 * Args: <artifactPath> <propsJson> [subjectOverride]
 * Prints a single JSON line to stdout.
 */
import { render } from "@react-email/render";
import { type ComponentType, createElement } from "react";

type Result =
  | {
      ok: true;
      value: { html: string; text?: string; subject: string };
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

async function main() {
  const artifactPath = process.argv[2];
  const propsJson = process.argv[3] ?? "{}";
  const subjectOverride = process.argv[4];

  if (!artifactPath) {
    write({
      ok: false,
      error: { code: "invalid_artifact", message: "Missing artifact path" },
    });
    process.exit(1);
  }

  try {
    const props = JSON.parse(propsJson) as Record<string, unknown>;
    const mod = (await import(artifactPath)) as {
      default?: ComponentType<Record<string, unknown>>;
      subject?:
        | string
        | ((p: Record<string, unknown>) => string | Promise<string>);
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

    let subject = subjectOverride;
    if (subject == null || subject.length === 0) {
      if (typeof mod.subject === "function") {
        subject = await mod.subject(props);
      } else if (typeof mod.subject === "string") {
        subject = mod.subject;
      }
    }

    if (subject == null || subject.length === 0) {
      write({
        ok: false,
        error: {
          code: "missing_subject",
          message:
            "reactEmail render requires export function subject(props) or a request subject.",
        },
      });
      process.exit(1);
    }

    const element = createElement(mod.default, props);
    const html = await render(element);
    const text = await render(element, { plainText: true });

    write({ ok: true, value: { html, text, subject } });
  } catch (error) {
    write({
      ok: false,
      error: {
        code: "render_failed",
        message:
          error instanceof Error
            ? error.message
            : "Sealed artifact render failed",
      },
    });
    process.exit(1);
  }
}

function write(result: Result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

await main();
