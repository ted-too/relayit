import { describe, expect, it } from "vitest";
import { signInErrorMessage } from "./sign-in-error";

describe("signInErrorMessage", () => {
  it("tells a password account's owner to sign in with their password", () => {
    expect(signInErrorMessage("account_not_linked")).toBe(
      "An account with this email already exists. Sign in with your email and password.",
    );
  });

  it("answers a code it doesn't know generically, without repeating it", () => {
    const code = "<img src=x onerror=alert(1)>";
    expect(signInErrorMessage(code)).toBe(
      "Sign-in didn't work. Try again, or sign in with your email and password.",
    );
  });
});
