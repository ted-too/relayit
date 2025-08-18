import { Button } from "@repo/old-ui/components/shadcn/button";
import { LoaderCircleIcon, RefreshCcwIcon } from "lucide-react";
import { useDataTable } from "@/components/data-table/provider";

type RefreshButtonProps = {
	onClick: () => void;
};

export function RefreshButton({ onClick }: RefreshButtonProps) {
	const { isLoading } = useDataTable();

	return (
		<Button
			className="h-9 w-9"
			disabled={isLoading}
			onClick={onClick}
			size="icon"
			variant="outline"
		>
			{isLoading ? (
				<LoaderCircleIcon className="h-4 w-4 animate-spin" />
			) : (
				<RefreshCcwIcon className="h-4 w-4" />
			)}
		</Button>
	);
}
