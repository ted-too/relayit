import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_NAMES } from "./lib/auth-client";

export async function middleware(request: NextRequest) {
	let sessionCookie = null;
	const cookieStore = await cookies();

	for (const cookieName of COOKIE_NAMES) {
		const cookie = cookieStore.get(cookieName);
		if (cookie) {
			sessionCookie = cookie;
		}
	}

	if (!sessionCookie) {
		console.log("[middleware] no session cookie found, redirecting to sign-in");
		return NextResponse.redirect(new URL("/auth/sign-in", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/~/:path*"],
};
