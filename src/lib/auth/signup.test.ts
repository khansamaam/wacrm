import { describe, expect, it } from "vitest";

import {
  getPostSignupDestination,
  hashSignupInviteToken,
} from "./signup";
import { hashInviteToken } from "./invitations";

describe("getPostSignupDestination", () => {
  it("sends an immediately-confirmed invited signup to the dashboard", () => {
    expect(getPostSignupDestination(true)).toBe("/dashboard");
  });

  it("waits for the verification-email redirect when no session exists", () => {
    expect(getPostSignupDestination(false)).toBeNull();
  });
});

describe("hashSignupInviteToken", () => {
  it("produces the same SHA-256 hex format stored by workspace invitations", async () => {
    await expect(hashSignupInviteToken("invite-token")).resolves.toBe(
      hashInviteToken("invite-token"),
    );
  });
});
