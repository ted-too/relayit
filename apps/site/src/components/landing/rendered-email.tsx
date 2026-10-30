import { cn } from "@repo/ui/lib/utils";

/**
 * What the `order-shipped` template renders to: the product's actual output,
 * drawn as an email client would show it. Fernwood Supply is the sample sender
 * used across the site.
 */
export function RenderedEmail({
  className,
  highlightVariable = false,
}: {
  className?: string;
  highlightVariable?: boolean;
}) {
  const orderId = highlightVariable ? (
    <mark className="rounded bg-brand-mint px-1 text-brand-ink">4821</mark>
  ) : (
    "4821"
  );
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-800 shadow-[0_30px_80px_-40px] shadow-brand-ink/40",
        className
      )}
    >
      <div className="flex items-center gap-3 border-neutral-100 border-b px-5 py-3.5">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#2f3b2a] font-semibold text-[13px] text-white">
          F
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-medium text-[13px]">Fernwood Supply</p>
          <p className="truncate text-[12px] text-neutral-500">
            orders@fernwood.shop to maya.okafor@example.com
          </p>
        </div>
      </div>
      <div className="px-6 pt-6 pb-7">
        <p className="font-semibold text-[22px] leading-snug tracking-tight">
          Order #{orderId} is on its way
        </p>
        <p className="mt-3 text-[13.5px] text-neutral-600 leading-relaxed">
          Your parcel left our workshop this morning. Tracking updates as it
          moves.
        </p>
        <span className="mt-5 inline-flex rounded-md bg-[#2f3b2a] px-4 py-2 font-medium text-[13px] text-white">
          Track parcel
        </span>
      </div>
    </div>
  );
}
