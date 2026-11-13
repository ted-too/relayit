import { ruleTester } from "../test/ruleTester.ts";
import rule from "./namespace-node-imports.ts";

ruleTester.run("namespace-node-imports", rule, {
  valid: [
    {
      name: "allows canonical Node namespaces",
      code: `
        import * as NodeFS from "node:fs";
        import * as NodeFSP from "node:fs/promises";
        import * as NodeAssert from "node:assert/strict";
        import * as NodeChildProcess from "node:child_process";
        import * as NodeTimersPromises from "node:timers/promises";
        import type * as NodeStream from "node:stream";

        NodeAssert.ok(NodeChildProcess.spawn && NodeTimersPromises.setTimeout);
        export const read = NodeFS.readFileSync;
        export const readAsync = NodeFSP.readFile;
        export type Input = NodeStream.Readable;
      `,
    },
    {
      name: "does not apply to non-Node packages",
      code: `import { BrowserWindow } from "electron";`,
    },
  ],
  invalid: [
    {
      name: "reports named imports",
      code: `import { readFile } from "node:fs/promises";`,
      errors: [{ message: "Import node:fs/promises as a namespace named NodeFSP." }],
    },
    {
      name: "reports default imports",
      code: `import path from "node:path";`,
      errors: [{ message: "Import node:path as a namespace named NodePath." }],
    },
    {
      name: "reports non-canonical namespace aliases",
      code: `
        import * as Crypto from "node:crypto";
        import * as NodeOs from "node:os";
      `,
      errors: [
        { message: "Import node:crypto as a namespace named NodeCrypto." },
        { message: "Import node:os as a namespace named NodeOS." },
      ],
    },
  ],
});
