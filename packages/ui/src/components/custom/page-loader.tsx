import { Loader } from "@repo/ui/components/animate-ui/icons/loader";

export function PageLoader() {
  return (
    <div className="flex h-svh w-full items-center justify-center">
      <Loader animate="default" size={32} />
    </div>
  );
}
