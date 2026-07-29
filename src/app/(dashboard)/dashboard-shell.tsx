'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PresenceHeartbeat } from '@/components/presence/presence-heartbeat';
import { firstAccessibleHref, moduleForPath } from '@/lib/auth/module-access';

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const {
    user,
    loading,
    profileLoading,
    profile,
    accountRole,
    moduleAccess,
    canAccessModule,
    isSuperAdmin,
    isPlatformWorkspace,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const routeModule = moduleForPath(pathname);
  const accessStatus = profile?.access_status ?? null;
  const routeDenied =
    !profileLoading &&
    !!accountRole &&
    !!routeModule &&
    !canAccessModule(routeModule);

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (
      !profileLoading &&
      isSuperAdmin &&
      !isPlatformWorkspace &&
      pathname === '/dashboard'
    ) {
      router.replace('/platform');
    }
  }, [isPlatformWorkspace, isSuperAdmin, pathname, profileLoading, router]);

  useEffect(() => {
    if (!routeDenied || !accountRole) return;
    router.replace(firstAccessibleHref(accountRole, moduleAccess));
  }, [routeDenied, accountRole, moduleAccess, router]);

  if (loading || (user && profileLoading) || routeDenied) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (accessStatus && accessStatus !== 'active') {
    return (
      <div className="bg-background flex h-screen items-center justify-center px-4">
        <div className="border-border bg-card w-full max-w-md rounded-xl border p-6 text-center">
          <h1 className="text-foreground text-xl font-semibold">
            {accessStatus === 'pending'
              ? 'Invitation acceptance required'
              : 'Workspace access removed'}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {accessStatus === 'pending'
              ? 'Return to your invitation link and accept it before opening the workspace.'
              : 'Contact your Client Admin if you need a new workspace invitation.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
