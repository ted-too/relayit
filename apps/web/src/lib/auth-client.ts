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
