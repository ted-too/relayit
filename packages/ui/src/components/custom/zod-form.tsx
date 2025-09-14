import type { ZodMeta } from "@repo/shared/zod";
import { Fragment, useMemo } from "react";
import type * as z4 from "zod/v4/core";
import { withForm } from "./form";

interface DynamicZodFormFieldsProps<T extends z4.$ZodObject> {
  schema: T;
  defaultValues: z4.infer<T>;
  baseKey?: string;
  form: any; // FIXME: we need to get the proper form type
}

export function DynamicZodFormFields<T extends z4.$ZodObject>({
  schema,
  defaultValues: _defaultValues,
  baseKey,
  form,
}: DynamicZodFormFieldsProps<T>) {
  const defaultValues = useMemo(
    () => (baseKey ? { [baseKey]: _defaultValues } : _defaultValues),
    [baseKey, _defaultValues]
  );

  const Form = withForm({
    defaultValues,
    render: ({ form }) => {
      function getFieldFromZodType<T extends z4.$ZodType>({
        key,
        type,
        parentPath,
      }: {
        key: string;
        type: T;
        parentPath?: string;
      }): React.ReactNode {
        const def = type._zod.def;
        const fieldName = parentPath ? `${parentPath}.${key}` : key;

        switch (def.type) {
          case "object": {
            const objDef = def as z4.$ZodObjectDef;
            return (
              <Fragment key={fieldName}>
                {Object.entries(objDef.shape)
                  .map(([nestedKey, nestedType]) => ({
                    key: nestedKey,
                    type: nestedType as z4.$ZodType,
                    order:
                      ((nestedType as any).meta?.() as ZodMeta)?.order ?? 999,
                  }))
                  .sort((a, b) => a.order - b.order)
                  .map(({ key: nestedKey, type: nestedType }) => {
                    return getFieldFromZodType({
                      key: nestedKey,
                      type: nestedType,
                      parentPath: fieldName,
                    });
                  })}
              </Fragment>
            );
          }

          case "optional": {
            const optionalDef = def as z4.$ZodOptionalDef;
            return getFieldFromZodType({
              key,
              type: optionalDef.innerType,
              parentPath,
            });
          }

          case "nullable": {
            const nullableDef = def as z4.$ZodNullableDef;
            return getFieldFromZodType({
              key,
              type: nullableDef.innerType,
              parentPath,
            });
          }

          case "default": {
            const defaultDef = def as z4.$ZodDefaultDef;
            return getFieldFromZodType({
              key,
              type: defaultDef.innerType,
              parentPath,
            });
          }

          case "string": {
            const metadata = (type as any).meta?.() as ZodMeta;
            return (
              <form.AppField key={key} name={fieldName}>
                {(field) => {
                  return (
                    <field.TextField
                      label={metadata?.title || key}
                      description={metadata?.description}
                      placeholder={metadata?.placeholder}
                      type={metadata?.type || "text"}
                    />
                  );
                }}
              </form.AppField>
            );
          }

          case "number":
          case "int": {
            const metadata = (type as any).meta?.() as ZodMeta;
            return (
              <form.AppField key={key} name={fieldName}>
                {(field) => {
                  return (
                    <field.TextField
                      label={metadata?.title || key}
                      description={metadata?.description}
                      placeholder={metadata?.placeholder}
                      type="number"
                    />
                  );
                }}
              </form.AppField>
            );
          }

          case "boolean": {
            const metadata = (type as any).meta?.() as ZodMeta;
            return (
              <form.AppField key={key} name={fieldName}>
                {(field) => {
                  return (
                    <field.SwitchField
                      label={metadata?.title || key}
                      description={metadata?.description}
                    />
                  );
                }}
              </form.AppField>
            );
          }

          case "enum": {
            const enumDef = def as z4.$ZodEnumDef;
            const metadata = (type as any).meta?.() as ZodMeta;
            const options = Object.keys(enumDef.entries).map((key) => ({
              value: key,
              label: key,
            }));

            return (
              <form.AppField key={key} name={fieldName}>
                {(field) => {
                  return (
                    <field.MultiSelectField
                      label={metadata?.title || key}
                      description={metadata?.description}
                      items={options}
                      multiple={false}
                    />
                  );
                }}
              </form.AppField>
            );
          }

          case "catch": {
            const catchDef = def as z4.$ZodCatchDef;
            return getFieldFromZodType({
              key,
              type: catchDef.innerType,
              parentPath,
            });
          }

          case "pipe": {
            const pipeDef = def as z4.$ZodPipeDef;
            return getFieldFromZodType({ key, type: pipeDef.in, parentPath });
          }

          case "readonly": {
            const readonlyDef = def as z4.$ZodReadonlyDef;
            return getFieldFromZodType({
              key,
              type: readonlyDef.innerType,
              parentPath,
            });
          }

          case "lazy": {
            const lazyDef = def as z4.$ZodLazyDef;
            return getFieldFromZodType({
              key,
              type: lazyDef.getter(),
              parentPath,
            });
          }

          default: {
            console.warn(`Unhandled Zod type: ${(def as any).type}`);
            return null;
          }
        }
      }

      return (
        <>
          {Object.entries(schema._zod.def.shape)
            .map(([key, type]) => ({
              key,
              type: type as z4.$ZodType,
              order: ((type as any).meta?.() as ZodMeta)?.order ?? 999,
            }))
            .sort((a, b) => a.order - b.order)
            .map(({ key, type }) =>
              getFieldFromZodType({
                key,
                type,
                parentPath: baseKey,
              })
            )}
        </>
      );
    },
  });

  return <Form form={form} />;
}
