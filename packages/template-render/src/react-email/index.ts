import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { render } from "@react-email/render";
import type { EmailContent } from "@repo/shared/forms";
import type { SendRawPayload } from "@repo/shared/providers";
import { createGenericError, type Result } from "@repo/shared/utils";
import * as React from "react";
import { renderingUtilitiesExporter } from "./esbuild/renderring-utilities-exporter";

export const RENDER_ERRORS = {
  COMPILATION_FAILED: "Failed to compile React component",
  EXECUTION_FAILED: "Failed to execute React component",
  RENDER_FAILED: "Failed to render component to HTML",
  INVALID_COMPONENT: "Invalid React Email component",
  MISSING_DEPENDENCIES: "Missing required React Email dependencies",
} as const;

export interface RenderOptions {
  pretty?: boolean;
  plainText?: boolean;
}

function processTemplate(template: string, props: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return props[key]?.toString() || match;
  });
}

export async function renderEmailServer(
  templateData: EmailContent & { props?: Record<string, any> },
  options: RenderOptions = {}
): Promise<Result<SendRawPayload<"email">>> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "react-email-")
  );
  const tempFilePath = path.join(tempDir, "email-component.tsx");

  const props = templateData.props ?? {};

  try {
    const processedSubject = processTemplate(templateData.subject, props);

    await fs.promises.writeFile(tempFilePath, templateData.template);

    const buildResult = await Bun.build({
      entrypoints: [tempFilePath],
      target: "node",
      format: "cjs",
      plugins: [renderingUtilitiesExporter([tempFilePath])],
    });

    if (buildResult.outputs.length === 0) {
      return {
        error: createGenericError(
          RENDER_ERRORS.COMPILATION_FAILED,
          "Bun bundler produced no output"
        ),
        data: null,
      };
    }

    const firstOutput = buildResult.outputs[0];
    if (!firstOutput) {
      return {
        error: createGenericError(
          RENDER_ERRORS.COMPILATION_FAILED,
          "No build output available"
        ),
        data: null,
      };
    }

    const bundledCode = await firstOutput.text();

    const context = vm.createContext({
      ...global,
      console,
      Buffer,
      TextDecoder,
      TextEncoder,
      URL,
      URLSearchParams,
      AbortController,
      AbortSignal,
      Event,
      EventTarget,
      ReadableStream,
      WritableStream,
      TransformStream,
      require: (moduleName: string) => {
        if (moduleName === "react") return React;
        if (moduleName === "@react-email/components")
          return require("@react-email/components");
        if (moduleName === "@react-email/render")
          return require("@react-email/render");
        return require(moduleName);
      },
      module: { exports: {} },
      exports: {},
      process,
    });

    vm.runInContext(bundledCode, context, { filename: "bundled-email.js" });

    const emailModule = context.module.exports;
    const EmailComponent = emailModule.default || emailModule;

    if (typeof EmailComponent !== "function") {
      return {
        error: createGenericError(
          RENDER_ERRORS.INVALID_COMPONENT,
          "No valid component found"
        ),
        data: null,
      };
    }

    const element = React.createElement(EmailComponent, props);
    const html = await render(element, { pretty: options.pretty ?? true });
    const text = await render(element, { plainText: true });

    return {
      error: null,
      data: {
        html,
        text,
        subject: processedSubject,
      },
    };
  } catch (error) {
    console.error("Template rendering error:", error);
    return {
      error: createGenericError(
        "Template rendering failed",
        error instanceof Error ? error.message : "Unknown error"
      ),
      data: null,
    };
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
