import { isServer } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { toast } from "sonner";

export type ErrorResponse = {
	message: string;
	details: string[];
};

export const noThrow = async <T>(
	trpc: Promise<T>,
	rawConfig?: {
		error?: string;
		success?: string;
		onSuccess?: (data: T) => void;
	}
): Promise<{ data: T; error: null } | { data: null; error: ErrorResponse }> => {
	const config = {
		error: rawConfig?.error ?? "Something went wrong",
		success: rawConfig?.success,
		onSuccess: rawConfig?.onSuccess,
	};

	try {
		const data = await trpc;

		if (!isServer && config.success) {
			toast.success(config.success);
		}

		if (config.onSuccess) {
			config.onSuccess(data);
		}

		return { data, error: null };
	} catch (error) {
		let errorResponse: ErrorResponse;
		if (error instanceof TRPCClientError) {
			errorResponse = {
				message: config.error,
				details: [error.message],
			};
		} else {
			errorResponse = {
				message: config.error,
				details: [(error as Error).message],
			};
		}

		if (!isServer) {
			toast.error(errorResponse.message, {
				description: errorResponse.details.join("\n"),
			});
		}

		return {
			data: null,
			error: errorResponse,
		};
	}
};
