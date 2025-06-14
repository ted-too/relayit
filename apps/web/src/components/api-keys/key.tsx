"use client";

import { type BaseApiKey, authClient } from "@/lib/auth-client";

import { ActionButton } from "@repo/ui/components/shadcn/button";
import { Card } from "@repo/ui/components/shadcn/card";
import { apiKeysListQueryKey } from "@/trpc/queries/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyIcon } from "lucide-react";
import { toast } from "sonner";

export function ApiKeyCard({ apiKey }: { apiKey: BaseApiKey }) {
	const queryClient = useQueryClient();

	const { mutateAsync: revokeKey, isPending: revokeLoading } = useMutation({
		mutationFn: async () => {
			const { error } = await authClient.apiKey.delete({
				keyId: apiKey.id,
			});

			if (error) {
				return toast.error(error.message || "Failed to revoke API key");
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: apiKeysListQueryKey,
			});
			toast.success("API key revoked successfully");
		},
	});

	return (
		<Card
			key={apiKey.id}
			className="flex flex-row items-center gap-3 px-4 py-3"
		>
			<KeyIcon className="size-4" />
			<div className="flex flex-col">
				<span className="font-semibold text-sm">{apiKey.name}</span>
				<span className="text-muted-foreground text-xs">
					Created: {new Date(apiKey.createdAt).toLocaleDateString()}
				</span>
			</div>
			<ActionButton
				className="relative ms-auto"
				isLoading={revokeLoading}
				size="sm"
				variant="outline"
				onClick={async () => await revokeKey()}
			>
				Revoke
			</ActionButton>
		</Card>
	);
}
