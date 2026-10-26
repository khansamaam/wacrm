'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  PREF_CHANGE_EVENT,
  desktopNotificationsEnabled,
  notificationPermission,
  requestNotificationPermission,
  setDesktopNotificationsEnabled,
  showTestNotification,
  type NotificationPermissionState,
} from '@/lib/desktop-notifications'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/** Settings > Appearance: browser notifications for new messages. */
export function DesktopNotificationsSetting() {
  const t = useTranslations('DesktopNotifications')
  const [permission, setPermission] = useState<NotificationPermissionState | null>(null)
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const read = () => {
      setPermission(notificationPermission())
      setEnabled(desktopNotificationsEnabled())
    }
    read()
    window.addEventListener(PREF_CHANGE_EVENT, read)
    return () => window.removeEventListener(PREF_CHANGE_EVENT, read)
  }, [])

  if (permission === null) return null

  return (
    <div className="space-y-3">
      <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <Bell className="text-muted-foreground size-4" />
        {t('settingsTitle')}
      </h3>
      <div className="border-border flex max-w-md items-center justify-between gap-4 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-foreground text-sm">{t('settingsDesc')}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {permission === 'unsupported'
              ? t('statusUnsupported')
              : permission === 'denied'
                ? t('statusBlocked')
                : permission === 'default'
                  ? t('statusNotAllowed')
                  : enabled
                    ? t('statusOn')
                    : t('statusOff')}
          </p>
        </div>
        {permission === 'granted' ? (
          <Switch
            checked={enabled}
            onCheckedChange={(value) => setDesktopNotificationsEnabled(!!value)}
            aria-label={t('settingsTitle')}
          />
        ) : permission === 'default' ? (
          <Button size="sm" onClick={() => void requestNotificationPermission()}>
            {t('enable')}
          </Button>
        ) : null}
      </div>
      {permission === 'granted' && (
        <div className="flex max-w-md items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!showTestNotification(t('testTitle'), t('testBody'))) {
                window.alert(t('testFailed'))
              }
            }}
          >
            {t('testButton')}
          </Button>
          <p className="text-muted-foreground text-xs">{t('testHint')}</p>
        </div>
      )}
    </div>
  )
}
