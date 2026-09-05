import { supabase } from './supabase';

// Both storage buckets involved (agent-documents, delivery-photos) are
// private, so every image needs a short-lived signed URL rather than a
// public one — see docs/admin-dashboard-handover.md.
export async function getSignedUrl(bucket: string, path: string, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
