import type * as z4 from "zod/v4/core";

function getDefaultFromZodType<T extends z4.$ZodType>(type: T): z4.infer<T> {
  const def = type._zod.def;

  switch (def.type) {
    case "object": {
      const defaultValues: Record<string, unknown> = {};
      const objDef = def as z4.$ZodObjectDef;

      for (const [key, value] of Object.entries(objDef.shape)) {
        if (!value) continue;
        defaultValues[key] = getDefaultFromZodType(value);
      }

      return defaultValues as z4.infer<T>;
    }

    case "default": {
      const defaultDef = def as z4.$ZodDefaultDef;
      return defaultDef.defaultValue as z4.infer<T>;
    }

    case "prefault": {
      const prefaultDef = def as z4.$ZodPrefaultDef;
      return prefaultDef.defaultValue as z4.infer<T>;
    }

    case "optional": {
      const optionalDef = def as z4.$ZodOptionalDef;
      return getDefaultFromZodType(optionalDef.innerType) as z4.infer<T>;
    }

    case "nullable": {
      const nullableDef = def as z4.$ZodNullableDef;
      return getDefaultFromZodType(nullableDef.innerType) as z4.infer<T>;
    }

    case "array": {
      return [] as z4.infer<T>;
    }

    case "record": {
      return {} as z4.infer<T>;
    }

    case "map": {
      return new Map() as z4.infer<T>;
    }

    case "set": {
      return new Set() as z4.infer<T>;
    }

    case "tuple": {
      const tupleDef = def as z4.$ZodTupleDef;
      const tupleDefaults = tupleDef.items.map((item) =>
        getDefaultFromZodType(item)
      );
      return tupleDefaults as z4.infer<T>;
    }

    case "union": {
      const unionDef = def as z4.$ZodUnionDef;
      // Use the first option's default
      return getDefaultFromZodType(unionDef.options[0]) as z4.infer<T>;
    }

    case "intersection": {
      const intersectionDef = def as z4.$ZodIntersectionDef;
      const leftDefault = getDefaultFromZodType(intersectionDef.left);
      const rightDefault = getDefaultFromZodType(intersectionDef.right);

      // Handle intersection by merging objects or returning appropriate fallback
      if (
        leftDefault !== null &&
        rightDefault !== null &&
        typeof leftDefault === "object" &&
        typeof rightDefault === "object" &&
        !Array.isArray(leftDefault) &&
        !Array.isArray(rightDefault)
      ) {
        return { ...leftDefault, ...rightDefault } as z4.infer<T>;
      }

      // Fallback to left side if merge isn't possible
      return (leftDefault ?? rightDefault ?? null) as z4.infer<T>;
    }

    case "literal": {
      const literalDef = def as z4.$ZodLiteralDef<any>;
      return literalDef.values[0] as z4.infer<T>;
    }

    case "enum": {
      // Return null for enums - could alternatively return first enum value
      return null as z4.infer<T>;
    }

    case "catch": {
      const catchDef = def as z4.$ZodCatchDef;
      return getDefaultFromZodType(catchDef.innerType) as z4.infer<T>;
    }

    case "transform": {
      // For transforms, we can't easily determine the default without running the transform
      return null as z4.infer<T>;
    }

    case "pipe": {
      const pipeDef = def as z4.$ZodPipeDef;
      return getDefaultFromZodType(pipeDef.in) as z4.infer<T>;
    }

    case "readonly": {
      const readonlyDef = def as z4.$ZodReadonlyDef;
      return getDefaultFromZodType(readonlyDef.innerType) as z4.infer<T>;
    }

    case "lazy": {
      const lazyDef = def as z4.$ZodLazyDef;
      return getDefaultFromZodType(lazyDef.getter()) as z4.infer<T>;
    }

    case "promise": {
      const promiseDef = def as z4.$ZodPromiseDef;
      const innerDefault = getDefaultFromZodType(promiseDef.innerType);
      return Promise.resolve(innerDefault) as z4.infer<T>;
    }

    case "function": {
      // Return a no-op function for function schemas
      // biome-ignore lint/suspicious/noEmptyBlockStatements: this is fine
      return (() => {}) as z4.infer<T>;
    }

    // Primitive types - return null
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "date":
    case "null":
    case "undefined":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "nan":
    case "file":
    case "custom":
    case "template_literal":
    case "success":
    case "nonoptional":
      return null as z4.infer<T>;

    default: {
      // Fallback for any unhandled types
      console.warn(`Unhandled Zod type: ${(def as any).type}`);
      return null as z4.infer<T>;
    }
  }
}

export function generateDefaultFromSchema<T extends z4.$ZodObject>(
  schema: T
): z4.infer<T> {
  const defaultValues: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema._zod.def.shape)) {
    if (!value) continue;
    defaultValues[key] = getDefaultFromZodType(value);
  }

  return defaultValues as z4.infer<T>;
}
