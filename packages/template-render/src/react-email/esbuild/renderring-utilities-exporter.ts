import { promises as fs } from "node:fs";
import path from "node:path";
import type { BunPlugin } from "bun";
import { escapeStringForRegex } from "./escape-string-for-regex";

const RENDER_MODULE_FILTER = /^react-email-module-that-will-export-render$/;
const REACT_EMAIL_COMPONENTS_FILTER = /@react-email\/components$/;
const REACT_FILTER = /^react$/;
const REACT_JSX_RUNTIME_FILTER = /^react\/jsx-dev-runtime$/;

export const renderingUtilitiesExporter = (
  emailTemplates: string[]
): BunPlugin => ({
  name: "rendering-utilities-exporter",
  setup(build) {
    // Handle the email template files
    build.onLoad(
      {
        filter: new RegExp(emailTemplates.map(escapeStringForRegex).join("|")),
      },
      async ({ path: pathToFile }) => {
        const contents = await fs.readFile(pathToFile, "utf8");
        return {
          contents: `${contents};
export { render } from 'react-email-module-that-will-export-render';
export { createElement as reactEmailCreateReactElement } from 'react';`,
          loader: path.extname(pathToFile).slice(1) as
            | "js"
            | "jsx"
            | "ts"
            | "tsx",
        };
      }
    );

    // Handle the virtual render module - must return absolute path for Bun
    build.onResolve({ filter: RENDER_MODULE_FILTER }, (_args) => {
      return {
        path: require.resolve("@react-email/components"),
        namespace: "file",
      };
    });

    // Handle @react-email/components resolution
    build.onResolve({ filter: REACT_EMAIL_COMPONENTS_FILTER }, (_args) => {
      return {
        path: require.resolve("@react-email/components"),
        namespace: "file",
      };
    });

    // Handle react resolution
    build.onResolve({ filter: REACT_FILTER }, (_args) => {
      return {
        path: require.resolve("react"),
        namespace: "file",
      };
    });

    // Handle react/jsx-dev-runtime resolution
    build.onResolve({ filter: REACT_JSX_RUNTIME_FILTER }, (_args) => {
      return {
        path: require.resolve("react/jsx-dev-runtime"),
        namespace: "file",
      };
    });
  },
});
