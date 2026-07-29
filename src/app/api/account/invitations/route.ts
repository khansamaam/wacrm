// ============================================================
// /api/account/invitations
//
//   GET  — list outstanding (un-redeemed, non-expired) invites.
//   POST — create a new invite link.
//
// Both admin+. The list endpoint is what the Members tab uses to
// populate the "Pending invitations" section; create is what the
// "Invite member" dialog calls.
//
// IMPORTANT: the plaintext token is returned exactly ONCE — in
// the POST response. We store only the SHA-256 hash on the row,
// so neither GET nor a future PATCH can ever resurface the
// link. The admin sees it in the creation modal, copies it, and
// shares it via WhatsApp/Slack/whatever they like. If they
// dismiss the modal without copying, the only recourse is to
// revoke and re-issue.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
import { isAccountRole } from "@/lib/auth/roles";
import { getPublicAppUrl } from "@/lib/auth/public-url";
import {
  ActiveWorkspaceError,
  provisionInvitedUser,
} from "@/lib/auth/provision-invited-user";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_LABEL_LEN = 80;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function GET() {
  try {
    const ctx = await requireRole("owner");

    const { data, error } = await ctx.supabase
      .from("account_invitations")
      .select(
        "id, role, label, invitee_email, created_by_user_id, created_at, expires_at, accepted_at, accepted_by_user_id",
      )
      .eq("account_id", ctx.accountId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/account/invitations] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load invitations" },
        { status: 500 },
      );
    }

    return NextResponse.json({ invitations: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    // 30/min per user. The Members tab is a clicks-only UI so any
    // legitimate admin is far below this; the cap exists to keep
    // a script run in a loop or a compromised admin session from
    // flooding `account_invitations` with rows.
    const limit = checkRateLimit(
      `admin:inviteCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | {
          email?: unknown;
          role?: unknown;
          expiresInDays?: unknown;
          label?: unknown;
        }
      | null;

    const role = body?.role;
    if (!isAccountRole(role) || !["agent", "viewer"].includes(role)) {
      return NextResponse.json(
        { error: "'role' must be either agent or viewer" },
        { status: 400 },
      );
    }

    const email =
      typeof body?.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: "A valid invitee email address is required" },
        { status: 400 },
      );
    }

    const expiresInDaysRaw = body?.expiresInDays;
    // `clampExpiryDays` tolerates undefined / NaN / negatives by
    // collapsing to the safe default, so we just pass the raw
    // value through after a type narrow.
    const expiresInDays =
      typeof expiresInDaysRaw === "number" ? expiresInDaysRaw : undefined;
    const expiryDays = clampExpiryDays(expiresInDays);
    const expiresAt = inviteExpiresAt(expiryDays);

    let label: string | null = null;
    if (typeof body?.label === "string") {
      const trimmed = body.label.trim();
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `Label must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      label = trimmed === "" ? null : trimmed;
    }

    const { token, hash } = generateInviteToken();
    const url = inviteUrl(token, getPublicAppUrl(request));
    const admin = supabaseAdmin();

    const { data, error } = await ctx.supabase
      .from("account_invitations")
      .insert({
        account_id: ctx.accountId,
        token_hash: hash,
        invitee_email: email,
        role,
        created_by_user_id: ctx.userId,
        label,
        expires_at: expiresAt.toISOString(),
      })
      .select("id, role, label, expires_at, created_at")
      .single();

    if (error || !data) {
      console.error("[POST /api/account/invitations] insert error:", error);
      return NextResponse.json(
        { error: "Failed to create invitation" },
        { status: 500 },
      );
    }

    let emailSent: boolean;
    try {
      ({ emailSent } = await provisionInvitedUser({
        admin,
        email,
        invitationHash: hash,
        redirectTo: url,
        accountId: ctx.accountId,
        role,
      }));
    } catch (provisionError) {
      await ctx.supabase
        .from("account_invitations")
        .delete()
        .eq("id", data.id);
      if (provisionError instanceof ActiveWorkspaceError) {
        return NextResponse.json(
          {
            error:
              provisionError.accountId === ctx.accountId
                ? "This user is already an active member of your workspace"
                : "This user already belongs to another active workspace",
          },
          { status: 409 },
        );
      }
      console.error(
        "[POST /api/account/invitations] provisioning error:",
        provisionError,
      );
      const message =
        provisionError instanceof Error
          ? provisionError.message
          : "Unknown invitation error";
      return NextResponse.json(
        { error: `Could not prepare the invitation: ${message}` },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        invitation: data,
        // Plaintext payload — visible to the admin exactly once.
        token,
        url,
        email,
        emailSent,
        expiresInDays: expiryDays,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
