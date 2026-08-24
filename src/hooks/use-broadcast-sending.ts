'use client';

import { useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { normalizeKey } from '@/lib/contacts/dedupe';
import { buildBroadcastTemplateParams } from '@/lib/whatsapp/broadcast-template-params';
import {
  resolveBroadcastVariables,
  type BroadcastVariableMapping,
} from '@/lib/whatsapp/broadcast-variables';
import type { Contact, MessageTemplate } from '@/types';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/** Kept as a public alias for the broadcast wizard's existing imports. */
export type VariableMapping = BroadcastVariableMapping;

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  headerMediaUrl?: string;
  /** One send-time media URL per carousel card, in template order. */
  carouselCardMediaUrls?: string[];
  whatsappNumberId: string;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

const QUERY_PAGE_SIZE = 1_000;
const IN_FILTER_CHUNK_SIZE = 500;
const INSERT_BATCH_SIZE = 200;

type BrowserSupabaseClient = ReturnType<typeof createClient>;
type CustomValueIndex = Map<string, Map<string, string>>;

/** Backwards-compatible export used by existing tests and UI helpers. */
export const resolveVariables = resolveBroadcastVariables;

async function fetchAllContacts(
  supabase: BrowserSupabaseClient,
  accountId: string
): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (let from = 0; ; from += QUERY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .order('id')
      .range(from, from + QUERY_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts.push(...((data ?? []) as Contact[]));
    if ((data?.length ?? 0) < QUERY_PAGE_SIZE) break;
  }
  return contacts;
}

async function fetchContactIdsForTags(
  supabase: BrowserSupabaseClient,
  tagIds: string[]
): Promise<string[]> {
  const contactIds = new Set<string>();
  for (
    let tagOffset = 0;
    tagOffset < tagIds.length;
    tagOffset += IN_FILTER_CHUNK_SIZE
  ) {
    const tagChunk = tagIds.slice(tagOffset, tagOffset + IN_FILTER_CHUNK_SIZE);
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', tagChunk)
        .range(from, from + QUERY_PAGE_SIZE - 1);
      if (error)
        throw new Error(`Failed to fetch contact tags: ${error.message}`);
      for (const row of data ?? []) contactIds.add(row.contact_id);
      if ((data?.length ?? 0) < QUERY_PAGE_SIZE) break;
    }
  }
  return [...contactIds];
}

async function fetchContactsByIds(
  supabase: BrowserSupabaseClient,
  accountId: string,
  contactIds: string[]
): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (let i = 0; i < contactIds.length; i += IN_FILTER_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .in('id', contactIds.slice(i, i + IN_FILTER_CHUNK_SIZE));
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts.push(...((data ?? []) as Contact[]));
  }
  return contacts;
}

async function fetchCustomValueIndex(
  supabase: BrowserSupabaseClient,
  contactIds: string[]
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  for (let i = 0; i < contactIds.length; i += IN_FILTER_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', contactIds.slice(i, i + IN_FILTER_CHUNK_SIZE));
    if (error)
      throw new Error(`Failed to load custom values: ${error.message}`);
    for (const row of data ?? []) {
      const values = index.get(row.contact_id) ?? new Map<string, string>();
      values.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, values);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveCustomFieldAudience(
    supabase: BrowserSupabaseClient,
    activeAccountId: string,
    filter: CustomFieldFilter
  ): Promise<Contact[]> {
    const contactIds = new Set<string>();
    for (let from = 0; ; from += QUERY_PAGE_SIZE) {
      let query = supabase
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', filter.fieldId)
        .range(from, from + QUERY_PAGE_SIZE - 1);
      if (filter.operator === 'is') query = query.eq('value', filter.value);
      else if (filter.operator === 'is_not')
        query = query.neq('value', filter.value);
      else query = query.ilike('value', `%${filter.value}%`);

      const { data, error } = await query;
      if (error)
        throw new Error(`Custom-field filter failed: ${error.message}`);
      for (const row of data ?? []) contactIds.add(row.contact_id);
      if ((data?.length ?? 0) < QUERY_PAGE_SIZE) break;
    }
    return fetchContactsByIds(supabase, activeAccountId, [...contactIds]);
  }

  async function upsertCsvContacts(
    supabase: BrowserSupabaseClient,
    activeAccountId: string,
    userId: string,
    csvRows: { phone: string; name?: string }[]
  ): Promise<Contact[]> {
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) if (row.phone) uniqueByPhone.set(row.phone, row);
    const phones = [...uniqueByPhone.keys()];
    const byPhone = new Map<string, Contact>();

    for (let i = 0; i < phones.length; i += IN_FILTER_CHUNK_SIZE) {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', activeAccountId)
        .in('phone_normalized', phones.slice(i, i + IN_FILTER_CHUNK_SIZE));
      if (error)
        throw new Error(`Failed to look up CSV contacts: ${error.message}`);
      for (const contact of (data ?? []) as Contact[]) {
        const phoneKey = normalizeKey(contact.phone ?? '');
        if (phoneKey) byPhone.set(phoneKey, contact);
      }
    }

    const missing = phones
      .filter((phone) => !byPhone.has(phone))
      .map((phone) => ({
        user_id: userId,
        account_id: activeAccountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));
    for (let i = 0; i < missing.length; i += INSERT_BATCH_SIZE) {
      const { data, error } = await supabase
        .from('contacts')
        .insert(missing.slice(i, i + INSERT_BATCH_SIZE))
        .select();
      if (error)
        throw new Error(`Failed to create CSV contacts: ${error.message}`);
      for (const contact of (data ?? []) as Contact[]) {
        const phoneKey = normalizeKey(contact.phone ?? '');
        if (phoneKey) byPhone.set(phoneKey, contact);
      }
    }

    return phones
      .map((phone) => byPhone.get(phone))
      .filter((value): value is Contact => Boolean(value));
  }

  async function resolveAudience(
    supabase: BrowserSupabaseClient,
    activeAccountId: string,
    userId: string,
    audience: AudienceConfig
  ): Promise<Contact[]> {
    let contacts: Contact[] = [];
    if (audience.type === 'all') {
      contacts = await fetchAllContacts(supabase, activeAccountId);
    } else if (audience.type === 'tags' && audience.tagIds?.length) {
      const ids = await fetchContactIdsForTags(supabase, audience.tagIds);
      contacts = await fetchContactsByIds(supabase, activeAccountId, ids);
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(
        supabase,
        activeAccountId,
        audience.customField
      );
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(
        supabase,
        activeAccountId,
        userId,
        audience.csvContacts
      );
    }

    if (audience.excludeTagIds?.length) {
      const excluded = new Set(
        await fetchContactIdsForTags(supabase, audience.excludeTagIds)
      );
      contacts = contacts.filter((contact) => !excluded.has(contact.id));
    }

    // Protect the unique broadcast/contact invariant even if a source query
    // or imported CSV contains duplicates.
    return [
      ...new Map(contacts.map((contact) => [contact.id, contact])).values(),
    ];
  }

  async function createAndSendBroadcast(
    payload: BroadcastPayload
  ): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('You are not signed in.');
      if (!accountId)
        throw new Error('Your profile is not linked to an account.');

      setProgress(5);
      const contacts = await resolveAudience(
        supabase,
        accountId,
        user.id,
        payload.audience
      );
      if (contacts.length === 0)
        throw new Error('No contacts found for this audience.');

      // Freeze personalization now. The worker must send exactly what the
      // creator reviewed, even if a contact or template changes while queued.
      setProgress(15);
      const customValues = await fetchCustomValueIndex(
        supabase,
        contacts.map((contact) => contact.id)
      );
      const headerType = payload.template.header_type;
      const isMediaHeader =
        headerType === 'image' ||
        headerType === 'video' ||
        headerType === 'document';
      const headerMediaUrl = payload.headerMediaUrl?.trim();

      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          template_snapshot: payload.template,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
          whatsapp_number_id: payload.whatsappNumberId,
        })
        .select('id')
        .single();
      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`
        );
      }

      const recipientRows = contacts.map((contact) => {
        const params = resolveBroadcastVariables(
          payload.variables,
          contact,
          customValues.get(contact.id)
        );
        return {
          broadcast_id: broadcast.id,
          contact_id: contact.id,
          status: 'pending' as const,
          queue_payload: {
            params,
            messageParams: buildBroadcastTemplateParams(payload.template, {
              body: params,
              headerMediaUrl:
                isMediaHeader && headerMediaUrl ? headerMediaUrl : undefined,
              carouselCardMediaUrls: payload.carouselCardMediaUrls,
            }),
          },
        };
      });

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (error) {
          await supabase
            .from('broadcasts')
            .update({ status: 'failed' })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to enqueue recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${error.message}`
          );
        }
        setProgress(
          20 + Math.round(((i + batch.length) / recipientRows.length) * 75)
        );
      }

      // This is only a low-latency kick. The database rows are the source of
      // truth and the scheduled worker will resume them if this request or the
      // user's browser disappears.
      fetch('/api/whatsapp/broadcast/worker', { method: 'POST' }).catch(
        () => undefined
      );

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
