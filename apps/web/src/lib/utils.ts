import { organizationMetadataSchema } from "@repo/shared";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getInitials(name: string) {
	return name
		.split(" ")
		.map((n) => n[0].toUpperCase())
		.slice(0, 2)
		.join("");
}

export function getOrganizationMetadata(metadata: string | null) {
	if (!metadata) return null;

	const result = organizationMetadataSchema.safeParse(JSON.parse(metadata));

	if (!result.success) return null;

	return result.data;
}
