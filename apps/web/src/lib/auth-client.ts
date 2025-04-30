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

export const COOKIE_NAMES = [
	"relayit.session_token",
	"__Secure-relayit.session_token",
];

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
