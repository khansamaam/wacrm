// ============================================================
// POST /api/v1/broadcasts — launch a template broadcast
// (scope: broadcasts:send).
//
// Body:
//   {
//     "name": "July promo",                 // optional label
//     "template_name": "promo_july",        // required, approved template
//     "template_language": "en_US",         // optional (default en_US)
//     "recipients": [                        // required, 1..1000
//       { "to": "+14155550123", "params": ["Jane"],
//         "message_params": { "carouselCards": [...] } },
//       { "to": "+14155550124" }
//     ]
//   }
//
// The broadcast + durable recipient jobs are persisted synchronously, then
// a bounded worker kick runs in `after()`. A scheduled worker continues any
// remaining/retryable jobs independently of this request. Poll
// `GET /api/v1/broadcasts/{id}` for progress.
//
// Response (202):
//   { "data": { "broadcast_id", "status": "sending",
//               "total_recipients", "accepted", "rejected" } }
// ============================================================

import { after } from 'next/server';

import { requireApiKey } from '@/lib/auth/api-context';

// The kick is deliberately bounded; the queue remains durable when the route
// is terminated and the scheduled worker resumes it later.
export const maxDuration = 60;
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import { createBroadcast, BroadcastError } from '@/lib/whatsapp/broadcast-core';
import { processBroadcastQueue } from '@/lib/whatsapp/broadcast-queue';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const templateName =
      typeof body.template_name === 'string' ? body.template_name : '';
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const plan = await createBroadcast(
      ctx.supabase,
      ctx.accountId,
      auditUserId,
      {
        name: typeof body.name === 'string' ? body.name : null,
        templateName,
        templateLanguage:
          typeof body.template_language === 'string'
            ? body.template_language
            : null,
        whatsappNumberId:
          typeof body.whatsapp_number_id === 'string'
            ? body.whatsapp_number_id.trim()
            : null,
        recipients: recipients.map((r) => ({
          to: typeof r?.to === 'string' ? r.to : '',
          params: Array.isArray(r?.params) ? r.params : undefined,
          messageParams:
            r?.message_params && typeof r.message_params === 'object'
              ? r.message_params
              : undefined,
        })),
      }
    );

    // This is a low-latency kick, not the durability mechanism. Jobs are
    // leased from Postgres and a cron invocation will recover any remainder.
    after(() => processBroadcastQueue({ accountId: ctx.accountId }));

    return ok(
      {
        broadcast_id: plan.broadcastId,
        status: 'sending',
        total_recipients: plan.planned.length,
        accepted: plan.planned.length,
        rejected: plan.rejected,
      },
      202
    );
  } catch (err) {
    if (err instanceof BroadcastError) {
      return fail(err.code, err.message, err.status);
    }
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
