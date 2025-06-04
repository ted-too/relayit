import { getStatusColor } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { MessageStatus } from "@repo/shared";

// TODO: Make generic for any status type

export function StatusIndicator({ status }: { status: MessageStatus }) {
	return (
		<div className="flex items-center justify-center">
			<div
				className={cn("h-2.5 w-2.5 rounded-[2px]", getStatusColor(status).bg)}
			/>
		</div>
	);
}
