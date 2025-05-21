export type ErrorResponse = {
	message: string;
	details: string[];
};

export const noThrow = async <T>(
	trpc: Promise<T>,
): Promise<{ data: T; error: null } | { data: null; error: ErrorResponse }> => {
	try {
		const data = await trpc;

		return { data: data, error: null };
	} catch (error) {
		return {
			data: null,
			error: {
				message: "Something went wrong",
				details: [(error as Error).message],
			},
		};
	}
};
