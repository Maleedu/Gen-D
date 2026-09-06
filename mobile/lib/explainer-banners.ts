import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage keys for the auction/bidding explainer banners — see
// docs/auction-explainer-banners-handover.md. Each trigger point is
// independent: dismissing one never touches the others. Same
// AsyncStorage.getItem/setItem pattern as gend_view_mode (lib/view-mode.tsx),
// no new storage abstraction.
export const EXPLAINER_BANNER_KEYS = {
  auctionPricing: 'gend_seen_banner_auction_pricing',
  bidSelection: 'gend_seen_banner_bid_selection',
  agentBidding: 'gend_seen_banner_agent_bidding',
} as const;

// Backs <ExplainerBanner>: tracks whether the given trigger point's banner
// has been dismissed. State lives here (not inside the presentational
// component) so a screen that renders the banner in more than one place at
// once — the Wall's bid input appears once per auction order card — has a
// single source of truth; dismissing on one card hides it everywhere
// immediately instead of only on that card's own local state.
export function useExplainerBanner(storageKey: string) {
  // null = not yet loaded from AsyncStorage; callers should render nothing
  // until it resolves, so the banner doesn't flash before we know it's
  // already been dismissed.
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (!ignore) setSeen(stored === 'true');
      } catch {
        // Storage unavailable — default to showing the banner.
        if (!ignore) setSeen(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [storageKey]);

  const dismiss = useCallback(() => {
    setSeen(true);
    AsyncStorage.setItem(storageKey, 'true').catch(() => {});
  }, [storageKey]);

  return { seen, dismiss };
}
