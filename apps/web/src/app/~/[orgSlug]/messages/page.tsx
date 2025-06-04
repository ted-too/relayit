import { MessagesTable } from "@/components/tables/messages";
import {
	Card,
	CardDescription,
	CardTitle,
	CardHeader,
	CardContent,
} from "@/components/ui/card";
import { SECONDARY_SIDEBAR_COOKIE_NAME } from "@/constants/sidebar";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";

export default async function MessagesPage() {
	const cookieStore = await cookies();

	return (
		<Card
			variant="shadow"
			className="mx-auto max-w-none"
			wrapperProps={{ className: "h-full" }}
		>
			<CardHeader className="pb-0">
				<CardTitle className="text-lg md:text-xl">Messages</CardTitle>
				<CardDescription className="text-xs md:text-sm">
					All your messages in one place
				</CardDescription>
			</CardHeader>
			<CardContent
				style={
					{
						// TBH Don't ask me why this works, but it does.
						// We need to prevent overflow of the content.
						// FIXME: This is a hack and needs to be fixed.
						"--tab-content-height":
							"calc(var(--content-height) - 5.25rem - 0.5rem - 1.25rem - calc(0.625rem*2) - 0.75rem )",
					} as CSSProperties
				}
				className="pt-4"
			>
				<MessagesTable
					controlsOpen={
						cookieStore.get(SECONDARY_SIDEBAR_COOKIE_NAME)?.value === "true"
					}
				/>
			</CardContent>
		</Card>
	);
}
