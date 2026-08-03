import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact, MessageTemplate } from '@/types';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { persistBroadcastInboxMessage } from '@/lib/whatsapp/broadcast-inbox';
import { resolveWhatsAppNumber } from '@/lib/whatsapp/numbers';
import {
  isRecipientNotAllowedError,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import {
  parseBroadcastVariableMappings,
  resolveBroadcastVariables,
} from '@/lib/whatsapp/broadcast-variables';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_JOBS = 100;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const LEASE_SECONDS = 180;

interface QueuePayload {
  params?: string[];
  messageParams?: SendTimeParams;
}

interface ClaimedRecipient {
  id: string;
  broadcast_id: string;
  contact_id: string;
  attempt_count: number;
  max_attempts: number;
  queue_payload: QueuePayload | null;
  lease_owner: string;
  contact: Contact | Contact[] | null;
  broadcast: BroadcastQueueParent | BroadcastQueueParent[] | null;
}

interface BroadcastQueueParent {
  id: string;
  account_id: string;
  user_id: string;
  template_name: string;
  template_language: string;
  template_variables: unknown;
  template_snapshot: unknown;
  whatsapp_number_id: string;
  status: string;
}

interface PreparedBroadcast {
  broadcast: BroadcastQueueParent;
  phoneNumberId: string;
  accessToken: string;
  template: MessageTemplate | null;
}

export interface BroadcastQueueRunOptions {
  accountId?: string;
  maxJobs?: number;
  batchSize?: number;
  timeBudgetMs?: number;
  db?: SupabaseClient;
}

export interface BroadcastQueueRunResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function parseQueuePayload(value: unknown): QueuePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as QueuePayload;
  return {
    params: Array.isArray(candidate.params)
      ? candidate.params.filter(
          (item): item is string => typeof item === 'string'
        )
      : undefined,
    messageParams:
      candidate.messageParams && typeof candidate.messageParams === 'object'
        ? candidate.messageParams
        : undefined,
  };
}

/** Exponential retry schedule: 1m, 5m, 15m, 1h, then 6h. */
export function broadcastRetryDelayMs(attemptCount: number): number {
  const delays = [60_000, 300_000, 900_000, 3_600_000, 21_600_000];
  return delays[Math.min(Math.max(attemptCount - 1, 0), delays.length - 1)];
}

/** Network, throttling, and Meta service failures are safe to retry. */
export function isRetryableBroadcastError(message: string): boolean {
  return /(?:fetch failed|network|timed?\s*out|ECONNRESET|ETIMEDOUT|Meta API error:\s*(?:408|425|429|5\d\d)|Meta (?:code )?(?:1|2|4|17|32|613|130429|131048|131056)\b)/i.test(
    message
  );
}

async function loadCustomValues(
  db: SupabaseClient,
  contactIds: string[]
): Promise<Map<string, Map<string, string>>> {
  const output = new Map<string, Map<string, string>>();
  if (contactIds.length === 0) return output;

  const { data, error } = await db
    .from('contact_custom_values')
    .select('contact_id, custom_field_id, value')
    .in('contact_id', contactIds);
  if (error)
    throw new Error(`Failed to load broadcast variables: ${error.message}`);

  for (const row of data ?? []) {
    const values = output.get(row.contact_id) ?? new Map<string, string>();
    values.set(row.custom_field_id, row.value ?? '');
    output.set(row.contact_id, values);
  }
  return output;
}

async function prepareBroadcast(
  db: SupabaseClient,
  broadcast: BroadcastQueueParent
): Promise<PreparedBroadcast> {
  const number = await resolveWhatsAppNumber({
    supabase: db,
    accountId: broadcast.account_id,
    whatsappNumberId: broadcast.whatsapp_number_id,
  });
  if (!number.access_token)
    throw new Error('WhatsApp access token is missing.');

  let template: MessageTemplate | null = null;
  if (isMessageTemplate(broadcast.template_snapshot)) {
    template = broadcast.template_snapshot;
  } else {
    let query = db
      .from('message_templates')
      .select('*')
      .eq('account_id', broadcast.account_id)
      .eq('name', broadcast.template_name)
      .eq('language', broadcast.template_language);
    query = number.waba_id
      ? query.eq('waba_id', number.waba_id)
      : query.is('waba_id', null);
    const { data, error } = await query.maybeSingle();
    if (error)
      throw new Error(`Failed to load broadcast template: ${error.message}`);
    if (data && !isMessageTemplate(data))
      throw new Error('Broadcast template is malformed.');
    template = data ?? null;
  }

  return {
    broadcast,
    phoneNumberId: number.phone_number_id,
    accessToken: decrypt(number.access_token),
    template,
  };
}

async function markSent(
  db: SupabaseClient,
  job: ClaimedRecipient,
  metaMessageId: string,
  inboxError: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from('broadcast_recipients')
    .update({
      status: 'sent',
      sent_at: now,
      completed_at: now,
      whatsapp_message_id: metaMessageId,
      error_message: inboxError,
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq('id', job.id)
    .eq('status', 'pending')
    .eq('lease_owner', job.lease_owner);
  if (error)
    throw new Error(`Failed to complete broadcast job: ${error.message}`);
}

async function markFailure(
  db: SupabaseClient,
  job: ClaimedRecipient,
  message: string
): Promise<'retried' | 'failed'> {
  const retry =
    job.attempt_count < job.max_attempts && isRetryableBroadcastError(message);
  const now = new Date();
  const update = retry
    ? {
        error_message: message,
        next_attempt_at: new Date(
          now.getTime() + broadcastRetryDelayMs(job.attempt_count)
        ).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      }
    : {
        status: 'failed',
        error_message: message,
        completed_at: now.toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      };

  const { error } = await db
    .from('broadcast_recipients')
    .update(update)
    .eq('id', job.id)
    .eq('status', 'pending')
    .eq('lease_owner', job.lease_owner);
  if (error)
    throw new Error(`Failed to update broadcast job: ${error.message}`);
  return retry ? 'retried' : 'failed';
}

async function finalizeBroadcasts(
  db: SupabaseClient,
  broadcastIds: Set<string>
): Promise<void> {
  for (const broadcastId of broadcastIds) {
    const { count, error } = await db
      .from('broadcast_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');
    if (error || (count ?? 0) > 0) continue;

    const { data: broadcast } = await db
      .from('broadcasts')
      .select('sent_count, delivered_count, read_count, replied_count')
      .eq('id', broadcastId)
      .maybeSingle();
    const successful =
      (broadcast?.sent_count ?? 0) +
        (broadcast?.delivered_count ?? 0) +
        (broadcast?.read_count ?? 0) +
        (broadcast?.replied_count ?? 0) >
      0;
    await db
      .from('broadcasts')
      .update({ status: successful ? 'sent' : 'failed' })
      .eq('id', broadcastId)
      .in('status', ['sending', 'scheduled']);
  }
}

/**
 * Drain queued recipients within a bounded execution window.
 *
 * Claims are atomic and leased in Postgres. A crashed worker leaves rows in
 * `pending`; another invocation safely reclaims them after lease expiry.
 */
export async function processBroadcastQueue(
  options: BroadcastQueueRunOptions = {}
): Promise<BroadcastQueueRunResult> {
  const db = options.db ?? supabaseAdmin();
  const workerId = `broadcast-${randomUUID()}`;
  const maxJobs = Math.min(
    Math.max(options.maxJobs ?? DEFAULT_MAX_JOBS, 1),
    500
  );
  const batchSize = Math.min(
    Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1),
    25
  );
  const deadline =
    Date.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const result: BroadcastQueueRunResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
  };

  while (result.claimed < maxJobs && Date.now() < deadline) {
    const claimLimit = Math.min(batchSize, maxJobs - result.claimed);
    const { data: claims, error: claimError } = await db.rpc(
      'claim_broadcast_recipient_jobs',
      {
        p_worker_id: workerId,
        p_limit: claimLimit,
        p_lease_seconds: LEASE_SECONDS,
        p_account_id: options.accountId ?? null,
      }
    );
    if (claimError)
      throw new Error(`Failed to claim broadcast jobs: ${claimError.message}`);
    const ids = (claims ?? []).map(
      (row: { recipient_id: string }) => row.recipient_id
    );
    if (ids.length === 0) break;
    result.claimed += ids.length;

    const { data, error } = await db
      .from('broadcast_recipients')
      .select(
        'id, broadcast_id, contact_id, attempt_count, max_attempts, queue_payload, lease_owner, contact:contacts(*), broadcast:broadcasts(id, account_id, user_id, template_name, template_language, template_variables, template_snapshot, whatsapp_number_id, status)'
      )
      .in('id', ids)
      .eq('lease_owner', workerId);
    if (error)
      throw new Error(
        `Failed to load claimed broadcast jobs: ${error.message}`
      );
    const jobs = (data ?? []) as unknown as ClaimedRecipient[];
    const customValues = await loadCustomValues(
      db,
      jobs.map((job) => job.contact_id)
    );
    const prepared = new Map<string, Promise<PreparedBroadcast>>();
    const touchedBroadcasts = new Set<string>();

    for (const job of jobs) touchedBroadcasts.add(job.broadcast_id);
    if (touchedBroadcasts.size > 0) {
      await db
        .from('broadcasts')
        .update({ status: 'sending' })
        .in('id', [...touchedBroadcasts])
        .eq('status', 'scheduled');
    }

    await Promise.all(
      jobs.map(async (job) => {
        const contact = one(job.contact);
        const broadcast = one(job.broadcast);
        if (!contact || !broadcast) {
          const outcome = await markFailure(
            db,
            job,
            'Broadcast contact or campaign no longer exists.'
          );
          result[outcome]++;
          return;
        }

        try {
          let preparation = prepared.get(broadcast.id);
          if (!preparation) {
            preparation = prepareBroadcast(db, broadcast);
            prepared.set(broadcast.id, preparation);
          }
          const ready = await preparation;
          const payload = parseQueuePayload(job.queue_payload);
          const params =
            payload.params ??
            resolveBroadcastVariables(
              parseBroadcastVariableMappings(broadcast.template_variables),
              contact,
              customValues.get(contact.id)
            );

          let sent: Awaited<ReturnType<typeof sendTemplateMessage>> | null =
            null;
          let sendError: unknown = null;
          for (const phone of phoneVariants(
            sanitizePhoneForMeta(contact.phone)
          )) {
            try {
              sent = await sendTemplateMessage({
                phoneNumberId: ready.phoneNumberId,
                accessToken: ready.accessToken,
                to: phone,
                templateName: broadcast.template_name,
                language: broadcast.template_language,
                template: ready.template ?? undefined,
                params,
                messageParams: payload.messageParams,
              });
              break;
            } catch (error) {
              sendError = error;
              const message =
                error instanceof Error ? error.message : String(error);
              if (!isRecipientNotAllowedError(message)) break;
            }
          }
          if (!sent)
            throw sendError ?? new Error('Meta did not accept the message.');

          let inboxError: string | null = null;
          try {
            await persistBroadcastInboxMessage(db, {
              accountId: broadcast.account_id,
              auditUserId: broadcast.user_id,
              contactId: contact.id,
              recipientPhone: contact.phone,
              whatsappNumberId: broadcast.whatsapp_number_id,
              metaMessageId: sent.messageId,
              templateName: broadcast.template_name,
              template: ready.template,
              params,
              messageParams: payload.messageParams,
            });
          } catch (inboxFailure) {
            inboxError =
              inboxFailure instanceof Error
                ? inboxFailure.message
                : 'Inbox persistence failed';
          }

          await markSent(db, job, sent.messageId, inboxError);
          result.sent++;
        } catch (failure) {
          const message =
            failure instanceof Error
              ? failure.message
              : 'Unknown broadcast error';
          const outcome = await markFailure(db, job, message);
          result[outcome]++;
        }
      })
    );

    await finalizeBroadcasts(db, touchedBroadcasts);
  }

  return result;
}
