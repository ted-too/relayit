import { describe, it } from "vitest";

/**
 * Seam: email sending-identity verify tasks (task handlers) — not HTTP.
 * Fake DNS / provider APIs at adapters; assert Domain / Sandbox / identity state transitions.
 */
describe("verifyOwnershipTask", () => {
  it.todo(
    "marks ownership verified when the expected DNS proof is present for the Project’s Domain"
  );

  it.todo("leaves ownership unverified when the DNS proof is missing or wrong");
});

describe("verifyDomainTask", () => {
  it.todo(
    "advances Domain verification when DKIM / DNS records match the Provider pairing"
  );
});

describe("verifyProviderIdentityTask", () => {
  it.todo(
    "verifies the Provider identity artifact for the Domain↔Provider pairing"
  );
});

describe("verifyProviderTask", () => {
  it.todo("verifies a Project email Provider is ready for sending setup");
});

describe("verifySandboxDomainTask", () => {
  it.todo(
    "verifies / keeps the Project Sandbox Domain ready on the managed Provider"
  );
});
