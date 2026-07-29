import type { AccountRole } from './roles';

/**
 * Top-level product areas that an account owner can expose per role.
 *
 * Settings is intentionally absent: every signed-in user keeps access to
 * their personal profile, security, and appearance settings. Existing role
 * capabilities continue to control workspace-setting edits.
 */
export const APP_MODULES = [
  'dashboard',
  'inbox',
  'notifications',
  'contacts',
  'pipelines',
  'broadcasts',
  'automations',
  'flows',
  'agents',
] as const;

export type AppModule = (typeof APP_MODULES)[number];

export const CONFIGURABLE_ROLES = ['admin', 'agent', 'viewer'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export type ModuleAccessConfig = Record<ConfigurableRole, AppModule[]>;

/** Existing accounts keep their current navigation after the migration. */
export const DEFAULT_MODULE_ACCESS: ModuleAccessConfig = {
  admin: [...APP_MODULES],
  agent: [...APP_MODULES],
  viewer: [...APP_MODULES],
};

const MODULE_HREF: Record<AppModule, string> = {
  dashboard: '/dashboard',
  inbox: '/inbox',
  notifications: '/notifications',
  contacts: '/contacts',
  pipelines: '/pipelines',
  broadcasts: '/broadcasts',
  automations: '/automations',
  flows: '/flows',
  agents: '/agents',
};

function isAppModule(value: unknown): value is AppModule {
  return (
    typeof value === 'string' &&
    (APP_MODULES as readonly string[]).includes(value)
  );
}

/**
 * Safely narrow JSONB from the database. Missing role keys inherit the
 * backwards-compatible defaults; an explicit empty array means no modules.
 */
export function normalizeModuleAccess(value: unknown): ModuleAccessConfig {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return Object.fromEntries(
    CONFIGURABLE_ROLES.map((role) => {
      const raw = source[role];
      if (!Array.isArray(raw)) {
        return [role, [...DEFAULT_MODULE_ACCESS[role]]];
      }
      return [role, [...new Set(raw.filter(isAppModule))]];
    })
  ) as ModuleAccessConfig;
}

export function canAccessModule(
  role: AccountRole,
  appModule: AppModule,
  access: ModuleAccessConfig
): boolean {
  return role === 'owner' || access[role].includes(appModule);
}

/** Match nested routes such as /broadcasts/new to their top-level module. */
export function moduleForPath(pathname: string): AppModule | null {
  for (const appModule of APP_MODULES) {
    const href = MODULE_HREF[appModule];
    if (pathname === href || pathname.startsWith(`${href}/`)) return appModule;
  }
  return null;
}

export function hrefForModule(appModule: AppModule): string {
  return MODULE_HREF[appModule];
}

export function firstAccessibleHref(
  role: AccountRole,
  access: ModuleAccessConfig
): string {
  const first = APP_MODULES.find((appModule) =>
    canAccessModule(role, appModule, access)
  );
  return first ? hrefForModule(first) : '/settings?tab=profile';
}
