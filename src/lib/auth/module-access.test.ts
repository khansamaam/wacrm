import { describe, expect, it } from 'vitest';

import {
  APP_MODULES,
  DEFAULT_MODULE_ACCESS,
  canAccessModule,
  firstAccessibleHref,
  moduleForPath,
  normalizeModuleAccess,
} from './module-access';

describe('module access', () => {
  it('preserves all existing modules when no configuration exists', () => {
    expect(normalizeModuleAccess(null)).toEqual(DEFAULT_MODULE_ACCESS);
  });

  it('keeps explicit empty role access and removes unknown modules', () => {
    const result = normalizeModuleAccess({
      agent: [],
      viewer: ['inbox', 'not-a-module', 'inbox'],
    });

    expect(result.agent).toEqual([]);
    expect(result.viewer).toEqual(['inbox']);
    expect(result.admin).toEqual(APP_MODULES);
  });

  it('always grants owner access and applies configured role access', () => {
    const access = normalizeModuleAccess({ agent: ['inbox'] });
    expect(canAccessModule('owner', 'broadcasts', access)).toBe(true);
    expect(canAccessModule('agent', 'inbox', access)).toBe(true);
    expect(canAccessModule('agent', 'broadcasts', access)).toBe(false);
  });

  it('maps nested dashboard paths to a module', () => {
    expect(moduleForPath('/broadcasts/new')).toBe('broadcasts');
    expect(moduleForPath('/flows/flow-1/runs')).toBe('flows');
    expect(moduleForPath('/settings')).toBeNull();
  });

  it('falls back to personal settings when a role has no modules', () => {
    const access = normalizeModuleAccess({ viewer: [] });
    expect(firstAccessibleHref('viewer', access)).toBe('/settings?tab=profile');
  });
});
