import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/useAuth';

export default function Login() {
  const { status, notAuthorizedMessage, clearNotAuthorizedMessage } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived rather than reset via an effect: once the AuthProvider settles
  // the post-sign-in admin check as "not authorized", this is no longer
  // "in flight" regardless of what `submitting` itself still holds. The
  // "authorized" outcome instead unmounts this screen entirely via the
  // redirect below, so it never depends on this.
  const isBusy = submitting && !notAuthorizedMessage;

  if (status === 'authorized') return <Navigate to="/" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    clearNotAuthorizedMessage();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setSubmitting(false);
      setError(error.message);
      return;
    }
    // Left submitting=true: AuthProvider's session listener takes over from
    // here (see lib/auth.tsx) and checks is_admin. This screen either
    // unmounts (redirected away, admin) or re-renders with
    // notAuthorizedMessage (not admin) once that settles.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="text-center text-2xl font-extrabold tracking-tight">Gen-D Admin</h1>
        <p className="mt-1 text-center text-sm text-gray-500">Staff sign-in only</p>

        {notAuthorizedMessage && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {notAuthorizedMessage}
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {isBusy ? 'Signing in…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  );
}
