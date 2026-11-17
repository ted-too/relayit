import { ruleTester } from "../test/ruleTester.ts";
import rule from "./require-suppression-reason.ts";

const lintDirective = {
  message: "Say why: end the directive with `-- reason` or put a comment on the line above.",
};
const typeScriptDirective = {
  message: "Say why: write the reason after the directive or in a comment on the line above.",
};

ruleTester.run("require-suppression-reason", rule, {
  valid: [
    {
      name: "allows a directive with a -- reason",
      filename: "fixture.tsx",
      code: `
        // oxlint-disable-next-line no-control-regex -- ANSI sequences start with ESC.
        const ansi = /\\x1b\\[/;
        /* eslint-disable no-console -- this script reports to the terminal */
      `,
    },
    {
      name: "allows a directive explained by the comment above",
      filename: "fixture.tsx",
      code: `
        // Positions are stable for a given string.
        // oxlint-disable-next-line react/no-array-index-key
        const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
      `,
    },
    {
      name: "allows stacked directives under one explanation",
      filename: "fixture.tsx",
      code: `
        // The fixture is invalid on purpose.
        // @ts-expect-error
        // oxlint-disable-next-line no-unused-vars
        const value: number = "text";
      `,
    },
    {
      name: "allows a TypeScript directive followed by its reason",
      filename: "fixture.tsx",
      code: `
        // @ts-expect-error the fixture passes a string on purpose
        const count: number = "text";
      `,
    },
    {
      name: "allows a directive in a JSX comment with a reason",
      filename: "fixture.tsx",
      code: `const el = <div>{/* oxlint-disable-next-line react/no-danger -- sanitized above */}</div>;`,
    },
    {
      name: "ignores enable directives",
      filename: "fixture.tsx",
      code: `/* oxlint-enable no-console */`,
    },
    {
      name: "allows an empty comment line between the reason and the directive",
      filename: "fixture.tsx",
      code: `
        // Positions are stable for a given string.
        //
        // oxlint-disable-next-line react/no-array-index-key
        const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
      `,
    },
  ],
  invalid: [
    {
      name: "reports a lint directive without a reason",
      filename: "fixture.tsx",
      code: `
        // oxlint-disable-next-line no-control-regex
        const ansi = /\\x1b\\[/;
      `,
      errors: [lintDirective],
    },
    {
      name: "reports a file-level directive without a reason",
      filename: "fixture.tsx",
      code: `/* oxlint-disable eslint/no-useless-escape */`,
      errors: [lintDirective],
    },
    {
      name: "reports a TypeScript directive without a reason",
      filename: "fixture.tsx",
      code: `
        // @ts-expect-error
        const count: number = "text";
      `,
      errors: [typeScriptDirective],
    },
    {
      name: "does not count a comment separated by a blank line",
      filename: "fixture.tsx",
      code: `
        // Positions are stable for a given string.

        // oxlint-disable-next-line react/no-array-index-key
        const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
      `,
      errors: [lintDirective],
    },
    {
      name: "does not count an empty comment above",
      filename: "fixture.tsx",
      code: `
        //
        /* */
        // oxlint-disable-next-line react/no-array-index-key
        const items = ["a"].map((item, index) => <li key={index}>{item}</li>);
      `,
      errors: [lintDirective],
    },
    {
      name: "does not count a trailing comment on the code line above",
      filename: "fixture.tsx",
      code: `
        const first = 1; // the first value
        const second = 2; // oxlint-disable-line no-unused-vars
      `,
      errors: [lintDirective],
    },
  ],
});
