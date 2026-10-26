'use client';

import type { WhatsAppNumber } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type NumberAccessChoice = 'none' | 'view' | 'full';
export type NumberAccessMap = Record<string, NumberAccessChoice>;

const CHOICE_LABEL: Record<NumberAccessChoice, string> = {
  none: 'No access',
  view: 'View only',
  full: 'Full access',
};

/** `{ id: level }` → the `[{ id, level }]` list the API expects. */
export function accessListFromMap(
  map: NumberAccessMap
): { id: string; level: 'view' | 'full' }[] {
  return Object.entries(map).flatMap(([id, level]) =>
    level === 'none' ? [] : [{ id, level }]
  );
}

export function accessMapFromList(
  list: { id: string; level: 'view' | 'full' }[] | undefined,
  legacyIds?: string[]
): NumberAccessMap {
  const map: NumberAccessMap = {};
  if (list && list.length > 0) {
    for (const entry of list) map[entry.id] = entry.level;
  } else {
    for (const id of legacyIds ?? []) map[id] = 'full';
  }
  return map;
}

/**
 * Per-number access picker used when inviting a member and when editing a
 * member: either every current and future number with full access, or a
 * level per number (No access / View only / Full access).
 */
export function NumberAccessEditor({
  numbers,
  mode,
  onModeChange,
  access,
  onAccessChange,
}: {
  numbers: WhatsAppNumber[];
  mode: 'all' | 'selected';
  onModeChange: (mode: 'all' | 'selected') => void;
  access: NumberAccessMap;
  onAccessChange: (numberId: string, level: NumberAccessChoice) => void;
}) {
  return (
    <div className="space-y-2">
      <Select
        value={mode}
        onValueChange={(value) =>
          value && onModeChange(value as 'all' | 'selected')
        }
      >
        <SelectTrigger className="w-full bg-muted border-border">
          <SelectValue>
            {mode === 'all'
              ? 'Full access to all current and future numbers'
              : 'Choose access per number'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            Full access to all current and future numbers
          </SelectItem>
          <SelectItem value="selected">Choose access per number</SelectItem>
        </SelectContent>
      </Select>
      {mode === 'selected' && (
        <div className="divide-y rounded-lg border">
          {numbers.map((number) => {
            const level = access[number.id] ?? 'none';
            return (
              <div
                key={number.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{number.label}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {number.display_phone_number || number.phone_number_id}
                  </div>
                </div>
                <Select
                  value={level}
                  onValueChange={(value) =>
                    value &&
                    onAccessChange(number.id, value as NumberAccessChoice)
                  }
                >
                  <SelectTrigger className="w-[150px] bg-muted border-border">
                    <SelectValue>{CHOICE_LABEL[level]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{CHOICE_LABEL.none}</SelectItem>
                    <SelectItem value="view">{CHOICE_LABEL.view}</SelectItem>
                    <SelectItem value="full">{CHOICE_LABEL.full}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <p className="text-muted-foreground p-3 text-xs">
            View only: can read that number&apos;s chats, but cannot reply,
            assign, close or send broadcasts. The member&apos;s role still
            applies on top (a Viewer is read-only everywhere).
          </p>
        </div>
      )}
    </div>
  );
}
