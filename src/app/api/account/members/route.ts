// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { isMissingAccessLevelSupport } from "@/lib/whatsapp/number-access";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  whatsapp_number_access_mode: 'all' | 'selected';
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, created_at, whatsapp_number_access_mode")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    type AssignmentRow = { user_id: string; whatsapp_number_id: string; access_level?: string };
    const withLevels = await ctx.supabase
      .from('whatsapp_number_members')
      .select('user_id, whatsapp_number_id, access_level')
      .eq('account_id', ctx.accountId);
    let assignments = withLevels.data as AssignmentRow[] | null;
    let assignmentError = withLevels.error;
    if (assignmentError && isMissingAccessLevelSupport(assignmentError)) {
      // Before migration 059 every assignment is full access.
      const legacy = await ctx.supabase
        .from('whatsapp_number_members')
        .select('user_id, whatsapp_number_id')
        .eq('account_id', ctx.accountId);
      assignments = legacy.data as AssignmentRow[] | null;
      assignmentError = legacy.error;
    }
    if (assignmentError) {
      return NextResponse.json({ error: 'Failed to load number assignments' }, { status: 500 });
    }
    const assignedByUser = new Map<string, { id: string; level: 'view' | 'full' }[]>();
    for (const assignment of assignments ?? []) {
      const list = assignedByUser.get(assignment.user_id) ?? [];
      list.push({
        id: assignment.whatsapp_number_id,
        level: assignment.access_level === 'view' ? 'view' : 'full',
      });
      assignedByUser.set(assignment.user_id, list);
    }

    const members = (data as ProfileRow[]).flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
          whatsapp_number_access_mode: row.account_role === 'owner' ? 'all' : row.whatsapp_number_access_mode,
          whatsapp_number_ids: (assignedByUser.get(row.user_id) ?? []).map((entry) => entry.id),
          whatsapp_number_access: assignedByUser.get(row.user_id) ?? [],
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
