import { Effect } from "effect";

export interface BunInstallResult {
  /**
   * The install's exit code, or null when it did not end by itself: `bun` could not be
   * started, or a signal killed it (out of memory). Either is the host's failure.
   */
  readonly exitCode: number | null;
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
      // `--no-env-file`: Bun would read a workspace's `.env`, and take the registry to ask
      // from a `BUN_CONFIG_REGISTRY` in it.
      const proc = Bun.spawn(["bun", "install", "--no-env-file", ...input.args], {
        cwd: input.cwd,
        // The install reads a customer's files, and Bun expands `${VAR}` in some of what it
        // reads: into the registry URL it requests, and into the stderr a failed preview
        // shows the Project. So it is handed only what it needs to run: where bun is, and
        // where its cache and temp files go. Nothing else of the builder's environment
        // reaches it.
        env: {
          BUN_INSTALL_IGNORE_SCRIPTS: "1",
          BUN_TMPDIR: process.env.BUN_TMPDIR,
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
        },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      return {
        // `exited` answers 128 + the signal for a killed child, which reads as its own exit.
        exitCode: proc.signalCode === null ? exitCode : null,
        ok: exitCode === 0,
        stderr: stderr.trim(),
      };
    } catch (error) {
      return {
        exitCode: null,
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
