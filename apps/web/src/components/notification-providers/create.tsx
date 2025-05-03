"use client";

import { Fragment, useCallback, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
	createProviderSchema,
	getProviderDefaults,
	type ChannelType,
	PROVIDER_CONFIG,
} from "@repo/shared";
import { useAppForm } from "@/components/ui/form";
import {
	type NotificationProvider,
	providersListQueryKey,
} from "@/qc/queries/providers";
import { apiClient, type ErrorResponse } from "@/lib/api";
import { useStore } from "@tanstack/react-form";
import { callRpc } from "@/lib/api";
import { z } from "zod";
import { getChangedFields } from "@/lib/utils";

interface CreateProviderFormProps {
	submitWrapper?: typeof DialogFooter;
	onSuccess?: () => void;
	channelType: ChannelType;
	initialData?: NotificationProvider;
}

export function CreateProviderForm({
	submitWrapper,
	onSuccess,
	channelType,
	initialData,
}: CreateProviderFormProps) {
	const queryClient = useQueryClient();
	const [isGeneratingSlug, setIsGeneratingSlug] = useState(false);

	// Get the default provider type for this channel
	const defaultProviderType = PROVIDER_CONFIG[channelType][0].type;

	// Get initial values either from initialData or defaults
	const defaultValues = initialData
		? {
				name: initialData.name,
				slug: initialData.slug,
				isActive: initialData.isActive,
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
					formApi.state.values.providerType,
				).safeParse(formApi.state.values);

				if (parseResult.success) return undefined;

				return parseResult.error;
			},
		},
		onSubmitInvalid: ({ formApi }) =>
			console.log(formApi.state.errors, formApi.state.values),
		onSubmit: async ({ value }) => {
			let error: ErrorResponse | null = null;

			if (initialData) {
				error = (
					await callRpc(
						apiClient.providers[":providerId"].$patch({
							param: { providerId: initialData.id },
							json: getChangedFields(value, defaultValues),
						}),
					)
				).error;
			} else {
				error = (
					await callRpc(
						apiClient.providers.$post({
							json: value,
						}),
					)
				).error;
			}

			if (error) return toast.error(error?.message);

			await queryClient.invalidateQueries({
				queryKey: providersListQueryKey,
			});

			toast.success(
				initialData
					? "Provider updated successfully"
					: "Provider created successfully",
			);

			onSuccess?.();
		},
	});

	const name = useStore(form.store, (state) => state.values.name);

	const generateSlug = useCallback(async () => {
		if (!name || name.length === 0) return;

		setIsGeneratingSlug(true);
		const { data } = await callRpc(
			apiClient.providers["generate-slug"].$post({
				json: {
					name,
				},
			}),
		);

		if (data) {
			form.setFieldValue("slug", data.slug);
		}

		setIsGeneratingSlug(false);
	}, [form, name]);

	const SubmitWrapper = submitWrapper ?? Fragment;

	// Get the current provider config
	const providerConfig = PROVIDER_CONFIG[channelType].find(
		(p) => p.type === (initialData?.providerType ?? defaultProviderType),
	);

	if (!providerConfig) return null;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="grid grid-cols-2 gap-4 w-full"
		>
			<form.AppField
				name="name"
				listeners={
					!initialData
						? {
								onChangeDebounceMs: 250,
								onChange: generateSlug,
							}
						: undefined
				}
				children={(field) => (
					<field.TextField
						label="Provider Name"
						description="Display name for this provider"
					/>
				)}
			/>

			<form.AppField
				name="slug"
				children={(field) => (
					<field.SlugField
						label="Provider Slug"
						isLoading={isGeneratingSlug}
						regenerate={generateSlug}
						description="Slug used in API calls"
					/>
				)}
			/>

			<form.AppField
				name="providerType"
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
			/>

			{/* Render credential fields based on schema */}
			{Object.entries(providerConfig.credentialsSchema.shape).map(
				([fieldName, fieldSchema]) => {
					const renderField = (
						path: string,
						schema: z.ZodTypeAny,
					): ReactElement | null => {
						// Check if field is one-time and we're in update mode
						const isOneTime = (fieldPath: string): boolean => {
							if (!initialData || !providerConfig.oneTimeFields) return false;
							const pathParts = fieldPath.split(".");
							let current = providerConfig.oneTimeFields;
							for (const part of pathParts) {
								if (current[part as keyof typeof current] === true) return true;
								if (typeof current[part as keyof typeof current] === "object") {
									current = current[part as keyof typeof current];
								} else {
									return false;
								}
							}
							return false;
						};

						if (schema instanceof z.ZodObject) {
							return (
								<Fragment key={path}>
									{Object.entries(schema.shape).map(([key, value]) =>
										renderField(
											path ? `${path}.${key}` : key,
											value as z.ZodTypeAny,
										),
									)}
								</Fragment>
							);
						}

						const isDisabled = isOneTime(path);

						if (schema instanceof z.ZodEnum) {
							return (
								<form.AppField
									key={path}
									name={`credentials.${path}`}
									children={(field) => (
										<field.SelectField
											label={path
												.split(".")
												.pop()!
												.split(/(?=[A-Z])/)
												.join(" ")
												.toLowerCase()
												.replace(/^./, (str) => str.toUpperCase())}
											options={schema.options.map((option: string) => ({
												label: option,
												value: option,
											}))}
											description={
												isDisabled
													? "This field cannot be changed after creation"
													: undefined
											}
											triggerProps={{
												disabled: isDisabled,
											}}
										/>
									)}
								/>
							);
						}

						return (
							<form.AppField
								key={path}
								name={`credentials.${path}`}
								children={(field) => (
									<field.TextField
										label={path
											.split(".")
											.pop()!
											.split(/(?=[A-Z])/)
											.join(" ")
											.toLowerCase()
											.replace(/^./, (str) => str.toUpperCase())}
										type={
											path.toLowerCase().includes("secret")
												? "password"
												: "text"
										}
										description={
											isDisabled
												? "This field cannot be changed after creation"
												: path.includes("unencrypted")
													? undefined
													: "This will be encrypted"
										}
										disabled={isDisabled}
									/>
								)}
							/>
						);
					};

					return renderField(fieldName, fieldSchema as z.ZodTypeAny);
				},
			)}

			<form.AppField
				name="isActive"
				children={(field) => (
					<field.CheckboxField
						label="Active"
						description="Whether this provider is active"
					/>
				)}
			/>

			<SubmitWrapper className="col-span-full">
				<form.AppForm>
					<form.SubmitButton className="w-full mt-6" size="lg">
						{initialData ? "Update" : "Create"}
					</form.SubmitButton>
				</form.AppForm>
			</SubmitWrapper>
		</form>
	);
}
