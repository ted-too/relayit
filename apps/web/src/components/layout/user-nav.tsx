"use client";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function LogoutButton({
	size = "md",
	className,
}: {
	size?: "sm" | "md";
	className?: string;
}) {
	const router = useRouter();

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						className={cn(
							"h-max p-0! w-max",
							size === "sm" && "[&_svg:not([class*='size-'])]:size-3",
							size === "md" && "[&_svg:not([class*='size-'])]:size-4",
							className,
						)}
						variant="link"
						onClick={async () => {
							const { error } = await authClient.signOut();
							if (error) {
								toast.error("Failed to sign out");
								return;
							}
							router.refresh();
						}}
					>
						<LogOutIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					<p>Sign out</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
