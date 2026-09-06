import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Customer/Driver mode — see docs/customer-driver-mode-handover.md. There is
// no `role` column anywhere in the schema; any account can post parcels and
// also browse/accept/bid on deliveries from the same login. This is purely a
// client-side navigation concern (which tabs + Home content are visible) and
// never gates a permission — KYC/RLS checks are unaffected by it.
export type ViewMode = 'customer' | 'driver';

const STORAGE_KEY = 'gend_view_mode';

type ViewModeContextValue = {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({ children }: { children: ReactNode }) {
  // Defaults to 'customer' immediately — the documented first-launch
  // default — and is overwritten the moment a stored 'driver' value (if
  // any) comes back from AsyncStorage.
  const [mode, setModeState] = useState<ViewMode>('customer');

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!ignore && stored === 'driver') setModeState('driver');
      } catch {
        // Storage unavailable — stay on the 'customer' default.
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const setMode = useCallback((next: ViewMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error('useViewMode must be used within a ViewModeProvider');
  return ctx;
}
