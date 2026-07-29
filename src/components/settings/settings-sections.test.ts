import { describe, expect, it } from 'vitest';

import {
  isWorkspaceSection,
  resolveAccessibleSection,
} from './settings-sections';

describe('settings access', () => {
  it('identifies account-wide workspace sections', () => {
    expect(isWorkspaceSection('whatsapp')).toBe(true);
    expect(isWorkspaceSection('members')).toBe(true);
    expect(isWorkspaceSection('profile')).toBe(false);
    expect(isWorkspaceSection('appearance')).toBe(false);
  });

  it('keeps workspace sections available to Admins and Owners', () => {
    expect(resolveAccessibleSection('whatsapp', true)).toBe('whatsapp');
    expect(resolveAccessibleSection('members', true)).toBe('members');
  });

  it('redirects Agent and Viewer workspace deep links to Overview', () => {
    expect(resolveAccessibleSection('whatsapp', false)).toBe('overview');
    expect(resolveAccessibleSection('members', false)).toBe('overview');
  });

  it('keeps personal settings available without workspace access', () => {
    expect(resolveAccessibleSection('profile', false)).toBe('profile');
    expect(resolveAccessibleSection('appearance', false)).toBe('appearance');
  });
});
