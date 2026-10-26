/**
 * Browser (desktop) notifications for inbound WhatsApp messages.
 *
 * The on/off preference is a per-browser convenience kept in localStorage;
 * the browser's own Notification permission is the real gate.
 */

const PREF_KEY = 'wacrm:desktop-notifications'
const PROMPT_DISMISSED_KEY = 'wacrm:desktop-notifications-prompt-dismissed'
export const PREF_CHANGE_EVENT = 'wacrm:desktop-notifications-change'

/** Dispatched with a conversation id; the inbox selects that thread. */
export const OPEN_CONVERSATION_EVENT = 'wacrm:open-conversation'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

export function notificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Storage may be unavailable (private mode); the default applies.
  }
}

/** Notifications are on unless this browser turned them off. */
export function desktopNotificationsEnabled(): boolean {
  return readStorage(PREF_KEY) !== 'off'
}

export function setDesktopNotificationsEnabled(enabled: boolean) {
  writeStorage(PREF_KEY, enabled ? 'on' : 'off')
  window.dispatchEvent(new Event(PREF_CHANGE_EVENT))
}

export function notificationPromptDismissed(): boolean {
  return readStorage(PROMPT_DISMISSED_KEY) === '1'
}

export function dismissNotificationPrompt() {
  writeStorage(PROMPT_DISMISSED_KEY, '1')
  window.dispatchEvent(new Event(PREF_CHANGE_EVENT))
}

/** Ask the browser for permission (must run from a click). */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (notificationPermission() === 'unsupported') return 'unsupported'
  const result = await Notification.requestPermission()
  if (result === 'granted') setDesktopNotificationsEnabled(true)
  window.dispatchEvent(new Event(PREF_CHANGE_EVENT))
  return result
}

const MEDIA_PREVIEW: Record<string, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎤 Voice message',
  document: '📄 Document',
  location: '📍 Location',
  sticker: 'Sticker',
}

/** Short notification body for a message row. */
export function messagePreview(message: {
  content_type?: string | null
  content_text?: string | null
}): string {
  const text = message.content_text?.trim()
  const media = MEDIA_PREVIEW[message.content_type ?? '']
  if (media) return text ? `${media}: ${text}` : media
  if (text) return text.length > 140 ? `${text.slice(0, 137)}…` : text
  return 'New message'
}
