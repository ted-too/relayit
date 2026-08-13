import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as dns from "node:dns";
import { lookupAuthoritativeNameservers } from "./live-dns";

afterEach(() => {
  mock.restore();
});

describe("lookupAuthoritativeNameservers", () => {
  test("returns NS records at the FQDN when they exist", async () => {
    spyOn(dns.promises, "resolveNs").mockImplementation((host) => {
      if (host === "acme.test") {
        return Promise.resolve([
          "ada.ns.cloudflare.com",
          "bob.ns.cloudflare.com",
        ]);
      }
      return Promise.reject(
        Object.assign(new Error("not found"), { code: "ENOTFOUND" })
      );
    });

    expect(await lookupAuthoritativeNameservers("acme.test")).toEqual([
      "ada.ns.cloudflare.com",
      "bob.ns.cloudflare.com",
    ]);
  });

  test("walks toward the parent zone when the FQDN has no NS", async () => {
    spyOn(dns.promises, "resolveNs").mockImplementation((host) => {
      if (host === "acme.test") {
        return Promise.resolve(["ada.ns.cloudflare.com"]);
      }
      return Promise.reject(
        Object.assign(new Error("not found"), { code: "ENODATA" })
      );
    });

    expect(await lookupAuthoritativeNameservers("mail.acme.test")).toEqual([
      "ada.ns.cloudflare.com",
    ]);
  });
});
