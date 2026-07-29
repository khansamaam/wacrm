'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Bot,
  GitBranch,
  LayoutDashboard,
  LockKeyhole,
  MessageSquare,
  Radio,
  RotateCcw,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import {
  APP_MODULES,
  CONFIGURABLE_ROLES,
  DEFAULT_MODULE_ACCESS,
  type AppModule,
  type ConfigurableRole,
  type ModuleAccessConfig,
} from '@/lib/auth/module-access';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

const MODULE_ICON: Record<AppModule, LucideIcon> = {
  dashboard: LayoutDashboard,
  inbox: MessageSquare,
  notifications: Bell,
  contacts: Users,
  pipelines: GitBranch,
  broadcasts: Radio,
  automations: Zap,
  flows: Workflow,
  agents: Bot,
};

function cloneAccess(access: ModuleAccessConfig): ModuleAccessConfig {
  return {
    admin: [...access.admin],
    agent: [...access.agent],
    viewer: [...access.viewer],
  };
}

export function RoleAccessSettings() {
  const { isOwner, moduleAccess, refreshProfile } = useAuth();
  const t = useTranslations('Settings.access');
  const tRoles = useTranslations('Settings.roles');
  const [draft, setDraft] = useState<ModuleAccessConfig>(() =>
    cloneAccess(moduleAccess)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(cloneAccess(moduleAccess));
  }, [moduleAccess]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(moduleAccess),
    [draft, moduleAccess]
  );

  function setModule(
    role: ConfigurableRole,
    module: AppModule,
    enabled: boolean
  ) {
    setDraft((current) => {
      const selected = enabled
        ? APP_MODULES.filter(
            (candidate) =>
              candidate === module || current[role].includes(candidate)
          )
        : current[role].filter((candidate) => candidate !== module);
      return { ...current, [role]: selected };
    });
  }

  async function save() {
    if (!isOwner || !dirty) return;
    setSaving(true);
    try {
      const response = await fetch('/api/account/module-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleAccess: draft }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error || t('saveFailed'));
      }
      await refreshProfile();
      toast.success(t('saved'));
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('saveFailed')
      );
    } finally {
      setSaving(false);
    }
  }

  if (!isOwner) return null;

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <Button
            variant="outline"
            onClick={() => setDraft(cloneAccess(DEFAULT_MODULE_ACCESS))}
            disabled={saving}
          >
            <RotateCcw className="size-4" />
            {t('restoreDefaults')}
          </Button>
        }
      />

      <div className="border-border bg-card overflow-x-auto rounded-xl border">
        <div className="min-w-[680px]">
          <div className="border-border bg-muted/40 grid grid-cols-[minmax(220px,1fr)_repeat(4,110px)] items-center border-b px-4 py-3">
            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              {t('module')}
            </div>
            <div className="text-foreground text-center text-xs font-semibold">
              {tRoles('owner')}
            </div>
            {CONFIGURABLE_ROLES.map((role) => (
              <div
                key={role}
                className="text-foreground text-center text-xs font-semibold"
              >
                {tRoles(role)}
              </div>
            ))}
          </div>

          {APP_MODULES.map((module) => {
            const Icon = MODULE_ICON[module];
            return (
              <div
                key={module}
                className="border-border grid grid-cols-[minmax(220px,1fr)_repeat(4,110px)] items-center border-b px-4 py-3 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" />
                  </span>
                  <span className="text-foreground truncate text-sm font-medium">
                    {t(`modules.${module}`)}
                  </span>
                </div>

                <div className="flex justify-center">
                  <span
                    className="bg-primary/10 text-primary inline-flex size-9 items-center justify-center rounded-full"
                    title={t('ownerAlways')}
                  >
                    <LockKeyhole className="size-4" />
                    <span className="sr-only">{t('ownerAlways')}</span>
                  </span>
                </div>

                {CONFIGURABLE_ROLES.map((role) => (
                  <div key={role} className="flex justify-center">
                    <Switch
                      checked={draft[role].includes(module)}
                      onCheckedChange={(checked) =>
                        setModule(role, module, checked)
                      }
                      aria-label={t('toggleLabel', {
                        module: t(`modules.${module}`),
                        role: tRoles(role),
                      })}
                      disabled={saving}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-border bg-muted/30 text-muted-foreground mt-3 rounded-lg border px-4 py-3 text-xs">
        {t('permissionHint')}
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </section>
  );
}
