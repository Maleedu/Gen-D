import { supabase } from './supabase';

// Mirrors the badge_code values award_agent_badges() actually inserts
// (32_agent_gamification.sql) — the DB only stores the code + earned_at,
// display metadata is presentation-only and lives here.
export type BadgeCode = 'first_delivery' | 'ten_deliveries' | 'fifty_deliveries' | 'century' | 'five_star_hero';

export type Badge = { badge_code: BadgeCode; earned_at: string };

export type GamificationProfile = {
  level_number: number;
  level_label: string;
  deliveries_into_level: number;
  // null at max level (Legend) — there's no "next" to count down to.
  deliveries_to_next_level: number | null;
  current_streak: number;
  badges: Badge[];
};

export const BADGE_META: Record<BadgeCode, { name: string; description: string; icon: string }> = {
  first_delivery: { name: 'First Delivery', description: 'Completed their very first delivery', icon: '🎉' },
  ten_deliveries: { name: 'Perfect Ten', description: 'Completed 10 deliveries', icon: '🎯' },
  fifty_deliveries: { name: 'Halfway Hero', description: 'Completed 50 deliveries', icon: '🏅' },
  century: { name: 'Century Club', description: 'Completed 100 deliveries', icon: '💯' },
  five_star_hero: { name: 'Five-Star Hero', description: 'Maintained a 4.9+ rating over at least 10 deliveries', icon: '🌟' },
};

// Every badge in display order, independent of which ones a given agent has
// actually earned — lets a screen render the full collection with locked
// slots for ones still out of reach.
export const ALL_BADGE_CODES: BadgeCode[] = [
  'first_delivery', 'ten_deliveries', 'fifty_deliveries', 'century', 'five_star_hero',
];

// One accent color per level number (1 Rookie -> 6 Legend), reused anywhere
// a level needs a badge/pill color — the dedicated stats screen and the
// small accent on Order Tracking's agent card both pull from this.
export const LEVEL_COLOR: Record<number, string> = {
  1: '#6b7280',
  2: '#1877F2',
  3: '#1877F2',
  4: '#B7791F',
  5: '#B7791F',
  6: '#E41E3F',
};

// Read-only and safe to call for any agent, not just the logged-in user —
// level/streak/badges are meant to be publicly visible, same as
// avg_rating_as_agent already is.
export async function fetchGamificationProfile(agentId: string): Promise<GamificationProfile | null> {
  const { data, error } = await supabase.rpc('get_agent_gamification_profile', { p_agent_id: agentId });
  if (error || !data) return null;
  return data as unknown as GamificationProfile;
}
