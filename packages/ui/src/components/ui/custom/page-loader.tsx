import { Spinner } from "@repo/ui/components/ui/coss/spinner";

export function PageLoader() {
  return (
    <div className="flex h-svh w-full items-center justify-center">
      <Spinner className="w-8" />
    </div>
  );
}
