import { NavLink, Outlet } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/useAuth';

const NAV_LINK_BASE = 'rounded-lg px-3 py-2 text-sm font-semibold transition';
const NAV_LINK_ACTIVE = 'bg-black text-white';
const NAV_LINK_INACTIVE = 'text-gray-600 hover:bg-gray-100';

export default function DashboardLayout() {
  const { email } = useAuth();

  return (
    <div className="min-h-screen bg-[#f5f6f8]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-lg font-extrabold tracking-tight">
              Gen-D <span className="text-brand">Admin</span>
            </span>
            <nav className="flex items-center gap-1">
              <NavLink
                to="/kyc"
                className={({ isActive }) =>
                  `${NAV_LINK_BASE} ${isActive ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE}`
                }
              >
                KYC Queue
              </NavLink>
              <NavLink
                to="/complaints"
                className={({ isActive }) =>
                  `${NAV_LINK_BASE} ${isActive ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE}`
                }
              >
                Complaints Queue
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {email && <span className="text-sm text-gray-500">{email}</span>}
            <button
              onClick={() => supabase.auth.signOut()}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
