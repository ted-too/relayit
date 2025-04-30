"use server";

import { cookies } from "next/headers";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SECONDARY_SIDEBAR_COOKIE_NAME = "secondary_sidebar_state";

export async function setSidebarStates({
	sidebarState,
	subSidebarState,
}: { sidebarState?: boolean; subSidebarState?: boolean }) {
	const cookieStore = await cookies();

	if (sidebarState) {
		cookieStore.set(SIDEBAR_COOKIE_NAME, sidebarState ? "true" : "false");
	}
	if (subSidebarState) {
		cookieStore.set(
			SECONDARY_SIDEBAR_COOKIE_NAME,
			subSidebarState ? "true" : "false",
		);
	}
}

export async function getSidebarStates() {
	const cookieStore = await cookies();

	return {
		sidebarState: cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === "true",
		subSidebarState:
			cookieStore.get(SECONDARY_SIDEBAR_COOKIE_NAME)?.value === "true",
	};
}
