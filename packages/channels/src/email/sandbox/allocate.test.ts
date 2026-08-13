import { describe, expect, test } from "bun:test";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { allocateSandboxDomain, sweepIfSandboxAllocatable } from "./allocate";

/**
 * Stand-in Effect DB for allocate/sweep.
 *
 * The pick query only returns a sandbox when the caller applies the usable
 * managed-identity join (innerJoin). That mirrors SQL excluding roots that
 * lack ≥1 verified platform identity.
 */
const makeDb = (input: {
  readonly allocatable?: { readonly id: string } | null;
  readonly sandboxRow?: {
    readonly isActive: boolean;
    readonly isPaused: boolean;
    readonly verificationStatus: string;
  } | null;
  readonly unassignedOrgIds?: readonly string[];
  readonly updates?: Array<{
    readonly organizationId: string;
    readonly sandboxDomainId: string;
  }>;
}) => {
  const updates = input.updates ?? [];
  const pick = input.allocatable === undefined ? null : input.allocatable;
  const unassigned = input.unassignedOrgIds ?? [];
  let identityJoinApplied = false;

  const finishPick = () => ({
    where: () => ({
      groupBy: () => ({
        orderBy: () => ({
          limit: () =>
            Effect.succeed(
              identityJoinApplied && pick
                ? [{ id: pick.id }]
                : ([] as { id: string }[])
            ),
        }),
      }),
    }),
  });

  const db: any = {
    query: {
      sandboxDomain: {
        findFirst: () => Effect.succeed(input.sandboxRow ?? null),
      },
    },
    select: () => ({
      from: () => ({
        /** Usable managed-identity filter (required for a non-empty pick). */
        innerJoin: () => {
          identityJoinApplied = true;
          return {
            innerJoin: () => ({
              leftJoin: () => finishPick(),
            }),
            leftJoin: () => finishPick(),
          };
        },
        leftJoin: () => finishPick(),
        where: () => Effect.succeed(unassigned.map((id) => ({ id }))),
      }),
    }),
    update: () => ({
      set: (values: { sandboxDomainId: string }) => ({
        where: (_clause: unknown) => {
          updates.push({
            organizationId: "captured-via-allocate",
            sandboxDomainId: values.sandboxDomainId,
          });
          return Effect.void;
        },
      }),
    }),
  };

  return { db, updates };
};

describe("allocateSandboxDomain", () => {
  test("returns null when no allocatable sandbox root is available", () =>
    Effect.runPromise(
      allocateSandboxDomain("org_1").pipe(
        Effect.provide(Layer.succeed(DB, makeDb({ allocatable: null }).db)),
        Effect.map((result) => {
          expect(result).toBeNull();
          return result;
        })
      )
    ));

  test("requires a usable managed identity join before assigning a root", () => {
    const { db, updates } = makeDb({
      allocatable: { id: "snd_ready" },
    });

    return Effect.runPromise(
      allocateSandboxDomain("org_1").pipe(
        Effect.provide(Layer.succeed(DB, db)),
        Effect.map((result) => {
          expect(result).toBe("snd_ready");
          expect(updates).toEqual([
            {
              organizationId: "captured-via-allocate",
              sandboxDomainId: "snd_ready",
            },
          ]);
          return result;
        })
      )
    );
  });
});

describe("sweepIfSandboxAllocatable", () => {
  test("returns 0 when the sandbox is not allocatable", () =>
    Effect.runPromise(
      sweepIfSandboxAllocatable("snd_1").pipe(
        Effect.provide(
          Layer.succeed(
            DB,
            makeDb({
              sandboxRow: {
                isActive: true,
                isPaused: false,
                verificationStatus: "not_verified",
              },
            }).db
          )
        ),
        Effect.map((assigned) => {
          expect(assigned).toBe(0);
          return assigned;
        })
      )
    ));

  test("assigns unassigned organizations while roots remain allocatable", () => {
    const { db, updates } = makeDb({
      allocatable: { id: "snd_ready" },
      sandboxRow: {
        isActive: true,
        isPaused: false,
        verificationStatus: "verified",
      },
      unassignedOrgIds: ["org_a", "org_b"],
    });

    return Effect.runPromise(
      sweepIfSandboxAllocatable("snd_ready").pipe(
        Effect.provide(Layer.succeed(DB, db)),
        Effect.map((assigned) => {
          expect(assigned).toBe(2);
          expect(updates).toHaveLength(2);
          expect(updates.every((u) => u.sandboxDomainId === "snd_ready")).toBe(
            true
          );
          return assigned;
        })
      )
    );
  });
});
