import { ruleTester } from "../test/ruleTester.ts";
import rule from "./prefer-catch-tags.ts";

const message = "Catch known tags with `Effect.catchTags({ Tag: handler })`, even for one tag.";

ruleTester.run("prefer-catch-tags", rule, {
  valid: [
    {
      name: "allows Effect.catchTags",
      code: `
        import * as Effect from "effect/Effect";

        export const program = Effect.fail({ _tag: "A" } as const).pipe(
          Effect.catchTags({ A: () => Effect.void }),
        );
      `,
    },
    {
      name: "ignores catchTag on other modules",
      code: `
        import * as Stream from "effect/Stream";

        export const recover = Stream.catchTag("A", () => Stream.empty);
      `,
    },
    {
      name: "ignores other exports of the effect barrel",
      code: `
        import { Stream } from "effect";

        export const recover = Stream.catchTag("A", () => Stream.empty);
      `,
    },
    {
      name: "ignores a local that shadows the namespace",
      code: `
        import * as Effect from "effect/Effect";

        export const program = Effect.void;
        export function recover(Effect: { catchTag: (tag: string) => void }) {
          Effect.catchTag("A");
        }
      `,
    },
  ],
  invalid: [
    {
      name: "reports Effect.catchTag",
      code: `
        import * as Effect from "effect/Effect";

        export const program = Effect.fail({ _tag: "A" } as const).pipe(
          Effect.catchTag("A", () => Effect.void),
        );
      `,
      errors: [{ message }],
    },
    {
      name: "reports catchTag through an aliased namespace",
      code: `
        import * as Eff from "effect/Effect";

        export const recover = Eff.catchTag("A", () => Eff.void);
      `,
      errors: [{ message }],
    },
    {
      name: "reports catchTag on the Effect export of the effect barrel",
      code: `
        import { Effect } from "effect";

        export const recover = Effect.catchTag("A", () => Effect.void);
      `,
      errors: [{ message }],
    },
    {
      name: "reports catchTag on an aliased Effect export of the effect barrel",
      code: `
        import { Effect as E } from "effect";

        export const recover = E.catchTag("A", () => E.void);
      `,
      errors: [{ message }],
    },
    {
      name: "reports a named catchTag import",
      code: `import { catchTag } from "effect/Effect";`,
      errors: [{ message }],
    },
  ],
});
