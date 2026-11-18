import { Button } from "@repo/ui/components/ui/coss/button";
import { useRouter } from "@tanstack/react-router";

/**
 * A route that failed to load, most often because the api couldn't be reached: Retry runs
 * its loading again, so the person needn't reload or sign in again.
 */
export function DefaultCatchBoundary() {
  const router = useRouter();
  return (
    <main className="m-auto flex max-w-sm flex-col items-center gap-4 p-6 text-center">
      <p>Something went wrong. Relayit may be unreachable right now.</p>
      <Button onClick={() => void router.invalidate()}>Retry</Button>
    </main>
  );
}
