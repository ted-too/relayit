import { ruleTester } from "../test/ruleTester.ts";
import rule from "./no-inline-schema-compile.ts";

ruleTester.run("no-inline-schema-compile", rule, {
  valid: [
    {
      name: "allows schema compilers hoisted to module scope",
      code: `
        import { Schema } from "effect";

        const User = Schema.Struct({ name: Schema.String });
        const decodeUser = Schema.decodeUnknownEffect(User);

        export const parseUser = (input: unknown) => decodeUser(input);
      `,
    },
    {
      name: "allows factory helpers that return a precompiled decoder",
      code: `
        import { Schema } from "effect";

        export const makeParser = <A, I>(schema: Schema.Codec<A, I>) => {
          const decode = Schema.decodeUnknownEffect(schema);
          return (input: unknown) => decode(input);
        };
      `,
    },
    {
      name: "allows schema construction helpers that use encode transformations",
      code: `
        import { Schema } from "effect";

        export const makePrettyJson = <S extends Schema.Top>(schema: S) =>
          Schema.fromJsonString(schema).pipe(
            Schema.encode({
              decode: Schema.String,
              encode: Schema.String,
            }),
          );
      `,
    },
    {
      name: "allows dynamic schema parameters that cannot be hoisted to module scope",
      code: `
        import { Schema } from "effect";

        export const parseWith = <A, I>(schema: Schema.Codec<A, I>, input: unknown) =>
          Schema.decodeUnknownEffect(schema)(input);
      `,
    },
  ],
  invalid: [
    {
      name: "reports schema compilers inside function bodies",
      code: `
        import { Schema } from "effect";

        const User = Schema.Struct({ name: Schema.String });

        export const parseUser = (input: unknown) => Schema.decodeUnknownEffect(User)(input);
      `,
      errors: [
        {
          message:
            "Hoist Schema.decodeUnknownEffect(...) to module scope: the compiled function is rebuilt on every call. Move it to a module-level const.",
        },
      ],
    },
    {
      name: "reports inline schema literals as high confidence findings",
      code: `
        import { Schema } from "effect";

        export const parseUser = (input: unknown) =>
          Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.String }))(input);
      `,
      errors: [
        {
          message:
            "Hoist Schema.decodeUnknownEffect(...) to module scope: both the inline schema literal and the compiled function are rebuilt on every call. Move the compiled function to a module-level const.",
        },
      ],
    },
  ],
});
