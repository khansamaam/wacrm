import type { Contact } from '@/types';

export type BroadcastVariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

/** Resolve positional template variables for one contact. */
export function resolveBroadcastVariables(
  variables: Record<string, BroadcastVariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>
): string[] {
  const keys = Object.keys(variables).sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  });

  return keys.map((key) => {
    const mapping = variables[key];
    if (mapping.type === 'static') return mapping.value;

    if (mapping.type === 'field') {
      const fields: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fields[mapping.value] ?? '';
    }

    return customValues?.get(mapping.value) ?? '';
  });
}

export function isBroadcastVariableMapping(
  value: unknown
): value is BroadcastVariableMapping {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; value?: unknown };
  return (
    typeof candidate.value === 'string' &&
    (candidate.type === 'static' ||
      candidate.type === 'field' ||
      candidate.type === 'custom_field')
  );
}

export function parseBroadcastVariableMappings(
  value: unknown
): Record<string, BroadcastVariableMapping> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, BroadcastVariableMapping] =>
        isBroadcastVariableMapping(entry[1])
    )
  );
}
