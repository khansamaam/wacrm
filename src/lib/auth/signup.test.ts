import { describe, expect, it } from "vitest";

import { getPostSignupDestination } from "./signup";

describe("getPostSignupDestination", () => {
  it("returns to the invitation when signup creates a session immediately", () => {
    expect(getPostSignupDestination("invite/token value", true)).toBe(
      "/join/invite%2Ftoken%20value",
    );
  });

  it("sends a normal immediately-confirmed signup to the dashboard", () => {
    expect(getPostSignupDestination(null, true)).toBe("/dashboard");
  });

  it("waits for the verification-email redirect when no session exists", () => {
    expect(getPostSignupDestination("invite-token", false)).toBeNull();
  });
});
