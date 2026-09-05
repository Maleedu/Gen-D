// Mirrors the Postgres enums from supabase/migrations — kept as string
// literal unions (not TS enums) to match the mobile app's style and stay
// erasable (no runtime representation needed for these).

export type DocType = 'aadhaar' | 'driving_licence' | 'vehicle_rc' | 'other';
export type DocVerificationStatus = 'pending' | 'verified' | 'rejected';
export type VehicleType = 'bike' | 'car' | 'bus' | 'other' | 'none';
export type ComplaintStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
export type OrderStatus = 'open' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export type AgentDocument = {
  id: string;
  profile_id: string;
  doc_type: DocType;
  storage_path: string;
  verification_status: DocVerificationStatus;
  verified_at: string | null;
  created_at: string;
  // Nested via the `profiles(...)` embed in the select query.
  profiles: {
    first_name: string;
    last_name: string;
    phone_number: string | null;
  } | null;
};

export type Complaint = {
  id: string;
  order_id: string;
  raised_by: string;
  reason: string;
  status: ComplaintStatus;
  created_at: string;
};
