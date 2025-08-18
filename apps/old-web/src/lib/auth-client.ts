import {
	apiKeyClient,
	organizationClient,
	passkeyClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_API_URL,
	plugins: [apiKeyClient(), organizationClient(), passkeyClient()],
});

export type Session = typeof authClient.$Infer.Session;
export type User = Session["user"];
export type Organization = typeof authClient.$Infer.Organization;
export type OrganizationMember = {
	id: string;
	organizationId: string;
	role: string;
	createdAt: Date;
	userId: string;
	user: {
		email: string;
		name: string;
		image: string | null | undefined;
	};
};

export type BaseApiKey = {
	metadata: any;
	permissions: any;
	id: string;
	name: string | null;
	start: string | null;
	prefix: string | null;
	userId: string;
	refillInterval: number | null;
	refillAmount: number | null;
	// TODO: More fields...
	createdAt: Date;
	updatedAt: Date;
};

export interface CreatedApiKey extends BaseApiKey {
	key: string;
}
