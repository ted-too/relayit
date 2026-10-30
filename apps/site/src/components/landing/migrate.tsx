const CHANGES = [
  { from: "api.resend.com/emails", to: "api.relayit.io/messages/email" },
  { from: "Authorization: Bearer re_…", to: "x-api-key: rel_org_…" },
] as const;

const KEPT = [
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "html",
  "text",
  "reply_to",
  "headers",
  "attachments",
  "tags",
  "scheduled_at",
];

/** Moving from Resend: two lines change, the body does not. */
export function Migrate() {
  return (
    <section className="scroll-mt-16 border-t" id="migrate">
      <div className="mx-auto max-w-[1400px] px-4 py-24 md:px-8 md:py-32">
        <h2 className="max-w-[18ch] font-semibold text-4xl tracking-[-0.03em] md:text-5xl">
          Leaving Resend is a two-line diff.
        </h2>

        <div className="mt-14 flex flex-col gap-10 md:mt-20 md:gap-14">
          {CHANGES.map((change) => (
            <div className="grid gap-2" key={change.to}>
              <p className="strike-reveal relative w-fit max-w-full break-all font-mono text-muted-foreground/70 text-xl md:text-4xl">
                <span aria-hidden className="mr-3 select-none md:mr-5">
                  -
                </span>
                {change.from}
              </p>
              <p className="reveal break-all font-medium font-mono text-2xl text-primary tracking-tight md:text-[3.25rem] md:leading-tight dark:text-brand-mint">
                <span aria-hidden className="mr-3 select-none md:mr-5">
                  +
                </span>
                {change.to}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-16 max-w-[70ch] md:mt-24">
          <p className="text-muted-foreground leading-relaxed">
            Every field in your request body keeps its name and shape:
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {KEPT.map((field) => (
              <span
                className="rounded-md border bg-card px-2 py-1 font-mono text-[12.5px]"
                key={field}
              >
                {field}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
