import { useDataTable } from "@/components/data-table/provider";
import { Button } from "@repo/ui/components/shadcn/button";
import { LoaderCircleIcon, RefreshCcwIcon } from "lucide-react";

interface RefreshButtonProps {
	onClick: () => void;
}

export function RefreshButton({ onClick }: RefreshButtonProps) {
	const { isLoading } = useDataTable();

	return (
		<Button
			variant="outline"
			size="icon"
			disabled={isLoading}
			onClick={onClick}
			className="h-9 w-9"
		>
			{isLoading ? (
				<LoaderCircleIcon className="h-4 w-4 animate-spin" />
			) : (
				<RefreshCcwIcon className="h-4 w-4" />
			)}
		</Button>
	);
}
