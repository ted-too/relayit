import { dynamicFormFieldsRegistry } from "@repo/api/validators/shared";
import { withForm } from "@repo/ui/components/ui/custom/form";
import * as z from "zod";

interface FieldResult {
  Component: React.ReactNode;
  order?: number;
}

export const DynamicForm = withForm({
  defaultValues: {} as any,
  props: {
    baseKey: null as string | null,
    schema: z.object({}) as z.core.$ZodObject,
  },
  render: ({ form, schema, baseKey }) => {
    function getFieldsFromZodType<T extends z.core.$ZodType>({
      field,
      key,
      parentPath,
    }: {
      field: T;
      key: string;
      parentPath?: string;
    }): FieldResult[] {
      const def = field._zod.def;
      const fieldName = parentPath ? `${parentPath}.${key}` : key;

      switch (def.type) {
        case "object": {
          const objDef = def as z.core.$ZodObjectDef;
          return Object.entries(objDef.shape).flatMap(
            ([nestedKey, nestedField]) =>
              getFieldsFromZodType({
                field: nestedField as z.core.$ZodType,
                key: nestedKey,
                parentPath: fieldName,
              })
          );
        }

        case "optional": {
          const optionalDef = def as z.core.$ZodOptionalDef;
          return getFieldsFromZodType({
            field: optionalDef.innerType,
            key,
            parentPath,
          });
        }

        case "nullable": {
          const nullableDef = def as z.core.$ZodNullableDef;
          return getFieldsFromZodType({
            field: nullableDef.innerType,
            key,
            parentPath,
          });
        }

        case "default": {
          const defaultDef = def as z.core.$ZodDefaultDef;
          return getFieldsFromZodType({
            field: defaultDef.innerType,
            key,
            parentPath,
          });
        }

        case "catch": {
          const catchDef = def as z.core.$ZodCatchDef;
          return getFieldsFromZodType({
            field: catchDef.innerType,
            key,
            parentPath,
          });
        }

        case "pipe": {
          const pipeDef = def as z.core.$ZodPipeDef;
          return getFieldsFromZodType({
            field: pipeDef.in,
            key,
            parentPath,
          });
        }

        case "readonly": {
          const readonlyDef = def as z.core.$ZodReadonlyDef;
          return getFieldsFromZodType({
            field: readonlyDef.innerType,
            key,
            parentPath,
          });
        }

        case "lazy": {
          const lazyDef = def as z.core.$ZodLazyDef;
          return getFieldsFromZodType({
            field: lazyDef.getter(),
            key,
            parentPath,
          });
        }

        default: {
          const metadata = dynamicFormFieldsRegistry.get(field);
          let Component: React.ReactNode = null;

          switch (metadata?.type) {
            case "text":
              Component = (
                <form.AppField key={fieldName} name={fieldName}>
                  {(field) => (
                    <field.TextField
                      className={{
                        label: metadata.title ? undefined : "sr-only",
                      }}
                      description={metadata.description}
                      label={metadata.title ?? fieldName}
                      placeholder={metadata.placeholder}
                    />
                  )}
                </form.AppField>
              );
              break;
            case "password":
              Component = (
                <form.AppField key={fieldName} name={fieldName}>
                  {(field) => (
                    <field.PasswordField
                      className={{
                        label: metadata.title ? undefined : "sr-only",
                      }}
                      description={metadata.description}
                      label={metadata.title ?? fieldName}
                      placeholder={metadata.placeholder}
                    />
                  )}
                </form.AppField>
              );
              break;
            case "select": {
              let items: { label: string; value: string }[] = [];

              if (def.type === "enum" && field._zod.values) {
                items = Array.from(field._zod.values).flatMap((value) => {
                  if (!value) {
                    return [];
                  }

                  return [
                    {
                      label: value.toString(),
                      value: value.toString(),
                    },
                  ];
                });
              }

              Component = (
                <form.AppField key={fieldName} name={fieldName}>
                  {(field) => (
                    <field.SelectField
                      className={{
                        label: metadata.title ? undefined : "sr-only",
                      }}
                      description={metadata.description}
                      items={items}
                      label={metadata.title ?? fieldName}
                    />
                  )}
                </form.AppField>
              );
              break;
            }
            default:
              return [];
          }

          return [
            {
              order: metadata.order,
              Component,
            },
          ];
        }
      }
    }

    return Object.entries(schema._zod.def.shape)
      .flatMap(([key, subField]) =>
        getFieldsFromZodType({
          field: subField as z.core.$ZodType,
          key,
          parentPath: baseKey ?? undefined,
        })
      )
      .sort((a, b) => {
        // If 'a.order' is undefined, push to end; same for 'b.order'
        if (a.order === undefined && b.order === undefined) {
          return 0;
        }

        if (a.order === undefined) {
          return 1;
        }

        if (b.order === undefined) {
          return -1;
        }

        return a.order - b.order;
      })
      .map(({ Component }) => Component);
  },
});
