import { Effect } from "effect";

export interface BunInstallResult {
  readonly ok: boolean;
  /** Install stderr, or the spawn error when `bun` could not start. */
  readonly stderr: string;
}

/**
 * Run `bun install <args>` in a workspace temp dir with lifecycle scripts off.
 * Never fails: callers map `ok: false` to their own TemplatingBuilderError.
 * Failures are logged with stderr so builder logs show why an install failed.
 */
export const runBunInstall = (input: {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly operation: string;
}) =>
  Effect.promise(async (): Promise<BunInstallResult> => {
    try {
      const proc = Bun.spawn(["bun", "install", ...input.args], {
        cwd: input.cwd,
        env: { ...process.env, BUN_INSTALL_IGNORE_SCRIPTS: "1" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      return { ok: exitCode === 0, stderr: stderr.trim() };
    } catch (error) {
      return {
        ok: false,
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }).pipe(
    Effect.tap((result) =>
      result.ok
        ? Effect.void
        : Effect.logWarning("bun install failed").pipe(
            Effect.annotateLogs({
              args: input.args.join(" "),
              operation: input.operation,
              stderr: result.stderr,
            }),
          ),
    ),
  );
