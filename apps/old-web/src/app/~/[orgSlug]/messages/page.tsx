import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/old-ui/components/shadcn/card";
import { SECONDARY_SIDEBAR_COOKIE_NAME } from "@repo/old-ui/constants";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";
import { MessagesTable } from "@/components/tables/messages";

export default async function MessagesPage() {
	const cookieStore = await cookies();

	return (
		<Card
			className="mx-auto max-w-none"
			variant="shadow"
			wrapperProps={{ className: "h-full" }}
		>
			<CardHeader className="pb-0">
				<CardTitle className="text-lg md:text-xl">Messages</CardTitle>
				<CardDescription className="text-xs md:text-sm">
					All your messages in one place
				</CardDescription>
			</CardHeader>
			<CardContent
				className="pt-4"
				style={
					{
						// TBH Don't ask me why this works, but it does.
						// We need to prevent overflow of the content.
						// FIXME: This is a hack and needs to be fixed.
						"--tab-content-height":
							"calc(var(--content-height) - 5.25rem - 0.5rem - 1.25rem - calc(0.625rem*2) - 0.75rem )",
					} as CSSProperties
				}
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
