export function CardList<T>({
  items,
  children,
  filters,
  emptyContent = "No items found",
  createCTAContent = "once you create one they will appear here",
}: {
  items: T[];
  children: (item: T) => React.ReactNode;
  filters?: { search: string };
  emptyContent?: string;
  createCTAContent?: string;
}) {
  if (items.length > 0) {
    return (
      <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
        {items.map((item) => children(item))}
      </div>
    );
  }

  const hasActiveSearch =
    filters?.search !== undefined && filters.search !== "";

  return (
    <div className="flex flex-col items-center justify-center gap-1 p-6 text-lg text-muted-foreground">
      {emptyContent}
      {hasActiveSearch ? (
        <span className="font-light text-sm">for "{filters.search}"</span>
      ) : (
        <p className="font-light text-sm">{createCTAContent}</p>
      )}
    </div>
  );
}
