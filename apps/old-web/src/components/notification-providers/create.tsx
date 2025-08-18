"use client";

import type {
	NotificationProvider,
	ProjectDetails,
	ProjectProviderAssociation,
} from "@repo/db";
import {
	type ChannelType,
	createProjectProviderSchema,
	createProviderSchema,
	getProjectProviderDefaults,
	getProviderDefaults,
	PROVIDER_CONFIG,
} from "@repo/shared";
import type { DialogFooter } from "@repo/ui/components/shadcn/dialog";
import { useAppForm, withForm } from "@repo/ui/components/shadcn/form";
import { useStore } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { Fragment, useCallback } from "react";
import type { z } from "zod/v4";
import { getChangedFields } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import { noThrow } from "@/trpc/no-throw";

type CreateProviderFormProps = {
	submitWrapper?: typeof DialogFooter;
	onSuccess?: () => void;
	channelType: ChannelType;
	initialData?: NotificationProvider;
};

export function CreateProviderForm({
	submitWrapper,
	onSuccess,
	channelType,
	initialData,
}: CreateProviderFormProps) {
	const utils = trpc.useUtils();
	const { mutateAsync: createProvider } = trpc.providers.create.useMutation({
		onSuccess: () => {
			utils.providers.list.invalidate();
		},
	});
	const { mutateAsync: updateProvider } = trpc.providers.update.useMutation({
		onSuccess: () => {
			utils.providers.list.invalidate();
		},
	});
	const { mutateAsync: generateSlugFn, isPending: isGeneratingSlug } =
		trpc.providers.generateSlug.useMutation();

	const defaultProviderType = PROVIDER_CONFIG[channelType][0].type;

	const defaultValues = initialData
		? {
				name: initialData.name,
				slug: initialData.slug,
				credentials: initialData.credentials,
				providerType: initialData.providerType,
				channelType: initialData.channelType,
			}
		: getProviderDefaults(channelType, defaultProviderType);

	const form = useAppForm({
		defaultValues,
		validators: {
			onSubmit: ({ formApi }) => {
				const parseResult = createProviderSchema(
					channelType,
					formApi.state.values.providerType
				).safeParse(formApi.state.values);

				if (parseResult.success) {
					return;
				}

				return parseResult.error;
			},
		},
		onSubmit: async ({ value }) => {
			const noThrowConfig = {
				error: "Failed to save provider",
				success: initialData
					? "Provider updated successfully"
					: "Provider created successfully",
				onSuccess,
			};

			if (initialData) {
				await noThrow(
					updateProvider({
						providerId: initialData.id,
						...getChangedFields(value, defaultValues),
					}),
					noThrowConfig
				);
			} else {
				await noThrow(createProvider(value), noThrowConfig);
			}
		},
	});

	const name = useStore(form.store, (state) => state.values.name);

	const generateSlug = useCallback(async () => {
		if (!name || name.length === 0) {
			return;
		}

		const { data } = await noThrow(
			generateSlugFn({
				name,
			})
		);

		if (data) {
			form.setFieldValue("slug", data.slug);
		}
	}, [form, name, generateSlugFn]);

	const SubmitWrapper = submitWrapper ?? Fragment;

	const providerConfig = PROVIDER_CONFIG[channelType].find(
		(p) => p.type === (initialData?.providerType ?? defaultProviderType)
	)!;

	// Specific isOneTimeField function for provider credentials
	const isCredentialOneTimeField = useCallback(
		(
			fieldPath: string,
			oneTimeFieldsDef?: Record<string, any> | boolean
		): boolean => {
			if (!(initialData && oneTimeFieldsDef)) {
				return false;
			}
			if (typeof oneTimeFieldsDef === "boolean") {
				return oneTimeFieldsDef; // Should not happen at top level
			}

			const pathParts = fieldPath.split(".");
			let current = oneTimeFieldsDef;
			for (const part of pathParts) {
				if (typeof current !== "object" || current === null) {
					return false;
				}
				if ((current as Record<string, any>)[part] === true) {
					return true;
				}
				if (typeof (current as Record<string, any>)[part] === "object") {
					current = (current as Record<string, any>)[part];
				} else {
					return false;
				}
			}
			return false;
		},
		[initialData]
	);

	// Specific getFieldDescription function for provider credentials
	const getCredentialFieldDescription = useCallback(
		(path: string, isDisabled: boolean): string | undefined => {
			if (isDisabled) {
				return "This field cannot be changed after creation";
			}
			if (path.includes("unencrypted")) {
				return; // e.g. unencrypted.region
			}

			return "This will be encrypted";
		},
		[]
	);

	return (
		<form
			className="grid w-full grid-cols-2 gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.AppField
				children={(field) => (
					<field.TextField
						description="Display name for this provider"
						label="Provider Name"
					/>
				)}
				listeners={
					initialData
						? undefined
						: {
								onChangeDebounceMs: 250,
								onChange: generateSlug,
							}
				}
				name="name"
			/>

			<form.AppField
				children={(field) => (
					<field.SlugField
						description="Slug used in API calls"
						isLoading={isGeneratingSlug}
						label="Provider Slug"
						regenerate={generateSlug}
					/>
				)}
				name="slug"
			/>

			<form.AppField
				children={(field) => (
					<field.SelectField
						label="Type"
						options={PROVIDER_CONFIG[channelType].map((option) => ({
							label: option.label,
							value: option.type,
						}))}
						triggerProps={{
							disabled: !!initialData,
						}}
					/>
				)}
				name="providerType"
			/>

			{/* Render credential fields based on schema */}
			<DynamicSchemaFields
				basePath="credentials"
				form={form}
				getFieldDescription={getCredentialFieldDescription}
				isFieldDisabled={isCredentialOneTimeField}
				oneTimeFieldsDefinition={providerConfig.oneTimeFields}
				schemaToRender={providerConfig.credentialsSchema}
			/>

			<SubmitWrapper className="col-span-full">
				<form.AppForm>
					<form.SubmitButton className="mt-6 w-full" size="lg">
						{initialData ? "Update" : "Create"}
					</form.SubmitButton>
				</form.AppForm>
			</SubmitWrapper>
		</form>
	);
}

const DynamicSchemaFields = withForm({
	defaultValues: undefined as any,
	props: {} as {
		basePath: string;
		schemaToRender: z.ZodType;
		isFieldDisabled?: (
			path: string,
			oneTimeFields?: Record<string, any> | boolean
		) => boolean;
		getFieldDescription?: (
			path: string,
			isDisabled: boolean
		) => string | undefined;
		oneTimeFieldsDefinition?: Record<string, any> | boolean;
	},
	render({
		form,
		basePath,
		schemaToRender,
		isFieldDisabled,
		getFieldDescription,
		oneTimeFieldsDefinition,
	}) {
		const renderField = (
			currentPath: string,
			schema: z.ZodType,
			currentOneTimeFieldsDef?: Record<string, any> | boolean
		) => {
			const fullPath = basePath ? `${basePath}.${currentPath}` : currentPath;
			const fieldIsDisabled = isFieldDisabled
				? isFieldDisabled(currentPath, currentOneTimeFieldsDef)
				: false;
			const description = getFieldDescription
				? getFieldDescription(currentPath, fieldIsDisabled)
				: undefined;
			const labelText = currentPath
				.split(".")
				.pop()
				?.split(/(?=[A-Z])/)
				.join(" ")
				.toLowerCase()
				.replace(/^./, (str) => str.toUpperCase());

			if (schema.def.type === "object") {
				return (
					<Fragment key={currentPath}>
						{Object.entries((schema as z.ZodObject<any>).shape).map(
							([key, value]) => {
								const nextOneTimeFieldsDef =
									typeof currentOneTimeFieldsDef === "object" &&
									currentOneTimeFieldsDef !== null
										? currentOneTimeFieldsDef[key]
										: undefined;
								return renderField(
									currentPath ? `${currentPath}.${key}` : key,
									value as z.ZodType,
									nextOneTimeFieldsDef
								);
							}
						)}
					</Fragment>
				);
			}

			if (schema.def.type === "enum") {
				return (
					<form.AppField
						children={(field) => (
							<field.SelectField
								description={description}
								label={labelText}
								options={(schema as z.ZodEnum<any>).options.map(
									(option: string) => ({
										label: option,
										value: option,
									})
								)}
								triggerProps={{
									disabled: fieldIsDisabled,
								}}
							/>
						)}
						key={fullPath}
						name={fullPath as any}
					/>
				);
			}

			// Default to TextField for other ZodString, ZodNumber, etc.
			if (
				schema.def.type === "string" ||
				schema.def.type === "number" ||
				schema.def.type === "boolean" // Booleans can also be text fields if not handled by CheckboxField specifically elsewhere
			) {
				return (
					<form.AppField
						children={(field) => (
							<field.TextField
								description={description}
								disabled={fieldIsDisabled}
								label={labelText}
								type={
									currentPath.toLowerCase().includes("secret") ||
									currentPath.toLowerCase().includes("token")
										? "password"
										: "text"
								}
							/>
						)}
						key={fullPath}
						name={fullPath as any}
					/>
				);
			}
			// Fallback for unknown types or if more specific handling is needed elsewhere
			return <></>;
		};

		if (schemaToRender && schemaToRender.def.type === "object") {
			// Pass the top-level oneTimeFieldsDefinition here
			return renderField("", schemaToRender, oneTimeFieldsDefinition);
		}
		return <></>;
	},
});

type CreateProjectProviderAssociationFormProps = {
	submitWrapper?: typeof DialogFooter;
	onSuccess?: () => void;
	provider: NotificationProvider;
	project: ProjectDetails;
	initialData?: ProjectProviderAssociation;
};

export function CreateProjectProviderAssociationForm({
	submitWrapper,
	onSuccess,
	project,
	provider,
	initialData,
}: CreateProjectProviderAssociationFormProps) {
	const utils = trpc.useUtils();
	const router = useRouter();

	const { mutateAsync: createAssociation } =
		trpc.projectProviderAssociations.create.useMutation({
			onSuccess: () => {
				utils.projects.getById.invalidate({
					projectId: project.id,
				});
				utils.projects.getBySlug.invalidate({
					slug: project.slug,
				});
				utils.projectProviderAssociations.list.invalidate({
					projectId: project.id,
				});
			},
		});
	const { mutateAsync: updateAssociation } =
		trpc.projectProviderAssociations.update.useMutation({
			onSuccess: () => {
				utils.projects.getById.invalidate({
					projectId: project.id,
				});
				utils.projects.getBySlug.invalidate({
					slug: project.slug,
				});
				utils.projectProviderAssociations.list.invalidate({
					projectId: project.id,
				});
			},
		});

	const defaultValues = initialData
		? {
				priority: initialData.priority,
				config: initialData.config,
			}
		: // Might need to explicitly set the priority based on existing associations
			getProjectProviderDefaults(provider.channelType, provider.providerType);

	const form = useAppForm({
		defaultValues,
		validators: {
			onSubmit: ({ formApi }) => {
				const parseResult = createProjectProviderSchema(
					provider.channelType,
					provider.providerType
				).safeParse(formApi.state.values);

				if (parseResult.success) {
					return;
				}

				return parseResult.error;
			},
		},
		onSubmit: async ({ value }) => {
			const noThrowConfig = {
				error: "Failed to save configuration",
				success: initialData
					? "Configuration updated successfully"
					: "Configuration created successfully",
				onSuccess: () => {
					// FIXME: This is a hack to refresh the page, we should use a better solution
					router.refresh();
					onSuccess?.();
				},
			};

			if (initialData) {
				await noThrow(
					updateAssociation({
						associationId: initialData.id,
						projectId: project.id,
						...getChangedFields(value, defaultValues),
					}),
					noThrowConfig
				);
			} else {
				await noThrow(
					createAssociation({
						...value,
						providerCredentialId: provider.id,
						projectId: project.id,
					}),
					noThrowConfig
				);
			}
		},
		onSubmitInvalid: ({ formApi }) => {},
	});

	const providerConfig = PROVIDER_CONFIG[provider.channelType].find(
		(p) => p.type === provider.providerType
	);

	const SubmitWrapper = submitWrapper ?? Fragment;

	return (
		<form
			className="grid w-full grid-cols-2 gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.AppField
				children={(field) => (
					<field.TextField
						description="Lower numbers have higher priority (e.g., 0 is highest)."
						label="Priority"
						type="number"
					/>
				)}
				name="priority"
			/>

			{providerConfig?.configSchema && (
				<DynamicSchemaFields
					basePath="config"
					form={form}
					getFieldDescription={(_path, _isDisabled) => {}}
					// Config fields are not "one-time" for creation, and standard description
					isFieldDisabled={() => false}
					schemaToRender={providerConfig.configSchema} // No special descriptions for config
				/>
			)}

			<SubmitWrapper className="col-span-full">
				<form.AppForm>
					<form.SubmitButton className="mt-6 w-full" size="lg">
						{initialData ? "Update" : "Create"}
					</form.SubmitButton>
				</form.AppForm>
			</SubmitWrapper>
		</form>
	);
}
