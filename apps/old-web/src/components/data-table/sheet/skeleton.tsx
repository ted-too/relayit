import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { cn } from "@repo/ui/lib/utils";
import type { SheetField } from "@/components/data-table/types";

type SheetDetailsContentSkeletonProps<TData, TMeta> = {
	fields: SheetField<TData, TMeta>[];
};

export function SheetDetailsContentSkeleton<TData, TMeta>({
	fields,
}: SheetDetailsContentSkeletonProps<TData, TMeta>) {
	return (
		<dl className="divide-y">
			{fields.map((field) => (
				<div
					className="flex items-center justify-between gap-4 py-2 text-sm"
					key={field.id.toString()}
				>
					<dt className="shrink-0 text-muted-foreground">{field.label}</dt>
					<div>
						<Skeleton className={cn("h-5 w-52", field.skeletonClassName)} />
					</div>
				</div>
			))}
		</dl>
	);
}
