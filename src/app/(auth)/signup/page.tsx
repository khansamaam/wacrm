import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';

import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Public self-registration is intentionally unavailable.
 *
 * New Auth users are created by the server after a Client Admin generates
 * an email-bound invitation. Migration 041 independently enforces the same
 * rule in the database, so bypassing this page cannot create an account.
 */
export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <BrandLogo size={48} className="h-12 w-12" />
          </div>
          <CardTitle className="text-xl text-foreground">
            Invitation required
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            WhatsApp Manager is invitation-only. Ask your Client Admin to
            invite your email address, then open the secure link sent to you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
            <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              Invitations are single-use, expire automatically, and can only
              be accepted by the email address selected by your administrator.
            </p>
          </div>
          <Link href="/login">
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Sign in to an existing account
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
