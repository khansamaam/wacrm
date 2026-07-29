import {
  Crown,
  Shield,
  ShieldCheck,
  UserCog,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import type { ChipVariant } from './settings-chip';

/**
 * Single source of truth for per-role chip metadata across settings
 * surfaces (the Overview identity chip and the Members roster/invite
 * chips). Previously duplicated in both files; hoisted here so a label,
 * icon, or colour change lands once.
 *
 * `variant` drives the token-based <SettingsChip>; `className` is the
 * inline Tailwind string the Members tab applies to its own spans.
 */
export const ROLE_META: Record<
  AccountRole,
  { icon: LucideIcon; label: string; variant: ChipVariant; className: string }
> = {
  owner: {
    icon: Crown,
    label: 'owner',
    variant: 'owner',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  },
  admin: {
    icon: Shield,
    label: 'admin',
    variant: 'admin',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  agent: {
    icon: UserCog,
    label: 'agent',
    variant: 'muted',
    className: 'border-border bg-muted text-muted-foreground',
  },
  viewer: {
    icon: UserIcon,
    label: 'viewer',
    variant: 'muted',
    // Outline-only so it stays quieter than the filled Agent chip in
    // both modes — bg-card would blend into a card surface in light mode.
    className: 'border-border bg-transparent text-muted-foreground',
  },
};

/**
 * Platform authority is independent from a workspace role. A platform
 * administrator can still be the `owner` of a workspace, but identity
 * surfaces should show the stronger platform role so operators are not
 * mistaken for an ordinary Client Admin.
 *
 * Keep this outside `ROLE_META`: it must never be accepted anywhere that
 * expects an assignable `AccountRole`.
 */
export const SUPER_ADMIN_META = {
  icon: ShieldCheck,
  label: 'superAdmin',
  variant: 'admin',
  className: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
} as const;
