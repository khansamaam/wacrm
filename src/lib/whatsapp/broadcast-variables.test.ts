import { describe, expect, it } from 'vitest';

import type { Contact } from '@/types';
import {
  parseBroadcastVariableMappings,
  resolveBroadcastVariables,
} from './broadcast-variables';

const contact = {
  id: 'contact-1',
  name: 'Aisha',
  phone: '971500000000',
  email: 'aisha@example.com',
  company: 'Acme',
} as Contact;

describe('broadcast variable snapshots', () => {
  it('resolves numeric placeholders in template order', () => {
    expect(
      resolveBroadcastVariables(
        {
          '10': { type: 'static', value: 'last' },
          '2': { type: 'custom_field', value: 'city' },
          '1': { type: 'field', value: 'name' },
        },
        contact,
        new Map([['city', 'Dubai']])
      )
    ).toEqual(['Aisha', 'Dubai', 'last']);
  });

  it('drops malformed persisted mappings instead of crashing a worker', () => {
    expect(
      parseBroadcastVariableMappings({
        '1': { type: 'field', value: 'name' },
        '2': { type: 'unknown', value: 'bad' },
        '3': null,
      })
    ).toEqual({ '1': { type: 'field', value: 'name' } });
  });
});
