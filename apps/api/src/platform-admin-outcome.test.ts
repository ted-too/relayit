import { describe, expect, it } from "@effect/vitest";
import { changedLines, unconfirmedLine } from "./platform-admin-outcome";

const email = "ada@example.test";
const store = { empty: false, host: "redis:6379", keyPrefix: "" };

describe("platform-admin.js's outcome", () => {
  it("says sessions were updated or the user signed out only when it found some", () => {
    expect(changedLines({ action: "grant", email, sessions: 2, store })).toEqual([
      "ada@example.test is a platform admin. Open sessions updated: 2.",
    ]);
    expect(changedLines({ action: "remove", email, sessions: 1, store })).toEqual([
      "ada@example.test is no longer a platform admin and is signed out. Open sessions ended: 1.",
    ]);
  });

  it("says a ban signed the user out only when it ended a session, and lifting one needs none", () => {
    expect(changedLines({ action: "ban", email, sessions: 2, store })).toEqual([
      "ada@example.test is banned and is signed out. Open sessions ended: 2.",
    ]);
    const none = changedLines({ action: "ban", email, sessions: 0, store });
    expect(none).toHaveLength(1);
    expect(none[0]).toContain("is banned in the database. No open sessions of theirs were found");
    expect(none[0]).toContain("the ban has not ended their sessions");
    expect(none[0]).not.toMatch(/signed out/);
    expect(
      changedLines({ action: "ban", email, sessions: 0, store: { ...store, empty: true } })[0],
    ).toMatch(/^Warning: /);

    // A ban ended the user's sessions, so none is expected, whatever the store holds.
    expect(
      changedLines({ action: "unban", email, sessions: 0, store: { ...store, empty: true } }),
    ).toEqual(["ada@example.test is no longer banned and can sign in again."]);
    expect(changedLines({ action: "unban", email, sessions: 1, store })).toEqual([
      "ada@example.test is no longer banned. Open sessions updated: 1.",
    ]);
  });

  it("says a ban that was not confirmed may have left the user signed in, and claims no harm for a lifted one", () => {
    expect(unconfirmedLine("ban", "their sessions are not confirmed")).toBe(
      "The user is banned in the database, but their sessions are not confirmed. Their open sessions may still be signed in until this is run again.",
    );
    expect(unconfirmedLine("unban", "their sessions are not confirmed")).toBe(
      "The ban is lifted in the database and the user can sign in, but their sessions are not confirmed. Run this again to confirm them.",
    );
  });

  it("names the store it searched when it found no session, and claims nothing for them", () => {
    for (const action of ["grant", "remove"] as const) {
      const lines = changedLines({
        action,
        email,
        sessions: 0,
        store: { ...store, keyPrefix: "prod:" },
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("in the database. No open sessions of theirs were found");
      expect(lines[0]).toContain('Redis at redis:6379, key prefix "prod:"');
      expect(lines[0]).toContain("the role change has not reached their sessions");
      expect(lines[0]).not.toMatch(/signed out|updated/);
    }
    expect(changedLines({ action: "remove", email, sessions: 0, store })[0]).toContain(
      "Redis at redis:6379, key prefix empty",
    );
  });

  it("warns first when the store holds no session of anyone", () => {
    const lines = changedLines({
      action: "remove",
      email,
      sessions: 0,
      store: { ...store, empty: true },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Warning: Redis at redis:6379, key prefix empty, holds no session/);
    expect(lines[1]).toContain("is no longer a platform admin in the database");
  });

  it("says a removal that was not confirmed may have left admin access", () => {
    expect(unconfirmedLine("remove", "1 of their sessions was read back unchanged")).toBe(
      "The role is removed in the database, but 1 of their sessions was read back unchanged. Their open sessions may still have platform admin access until this is run again.",
    );
    expect(unconfirmedLine("grant", "their sessions could not be read back")).toBe(
      "The role is granted in the database, but their sessions could not be read back. Their open sessions may not have it until this is run again.",
    );
  });
});
