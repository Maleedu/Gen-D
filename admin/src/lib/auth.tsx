import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { AuthContext } from './authContext';
import type { AuthContextValue } from './authContext';

type AuthStatus = AuthContextValue['status'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [notAuthorizedMessage, setNotAuthorizedMessage] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    // The one and only admin check, per docs/admin-dashboard-handover.md:
    // any session belonging to a non-admin profile is immediately signed
    // back out and never gets to render the dashboard shell. Run on every
    // session change (initial load, sign-in, sign-out, token refresh), not
    // just right after the login form submits, so a stale non-admin session
    // sitting in localStorage from a previous attempt is caught too.
    async function checkAdminAndSettle(session: Session | null) {
      if (!session) {
        if (!ignore) {
          setStatus('signed-out');
          setEmail(null);
        }
        return;
      }
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .single();
      if (ignore) return;
      if (error || !data?.is_admin) {
        await supabase.auth.signOut();
        if (!ignore) {
          setStatus('signed-out');
          setEmail(null);
          setNotAuthorizedMessage("This account isn't authorized for the admin dashboard.");
        }
        return;
      }
      setStatus('authorized');
      setEmail(session.user.email ?? null);
    }

    supabase.auth.getSession().then(({ data }) => checkAdminAndSettle(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Deferred per Supabase's own guidance: calling back into the client
      // (here, a DB select and possibly auth.signOut()) synchronously inside
      // this callback can deadlock, since it runs before the client's
      // internal auth lock releases.
      setTimeout(() => checkAdminAndSettle(session), 0);
    });

    return () => {
      ignore = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email,
      notAuthorizedMessage,
      clearNotAuthorizedMessage: () => setNotAuthorizedMessage(null),
    }),
    [status, email, notAuthorizedMessage],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
