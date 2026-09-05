import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getSignedUrl } from '../lib/signedUrl';
import type { AgentDocument, DocType, DocVerificationStatus, VehicleType } from '../lib/types';

type Tab = 'pending' | 'verified' | 'rejected' | 'all';

const TABS: { value: Tab; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

const DOC_TYPE_LABEL: Record<DocType, string> = {
  aadhaar: 'Aadhaar',
  driving_licence: 'Driving licence',
  vehicle_rc: 'Vehicle RC',
  other: 'Other document',
};

const STATUS_BADGE: Record<DocVerificationStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  verified: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

// aadhaar + driving_licence are always required; vehicle_rc only counts
// toward "ready to approve" for agents who've declared a vehicle (per
// docs/admin-dashboard-handover.md).
const REQUIRED_DOC_TYPES: DocType[] = ['aadhaar', 'driving_licence', 'vehicle_rc'];

type AgentGroup = {
  profileId: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  isAgentVerified: boolean;
  documents: AgentDocument[];
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function KycQueue() {
  const [documents, setDocuments] = useState<AgentDocument[] | null>(null);
  const [vehicleTypeByProfile, setVehicleTypeByProfile] = useState<Record<string, VehicleType>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('pending');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string | null>>({});
  const [loadingImageDocId, setLoadingImageDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const [{ data: docs, error: docsError }, { data: vehicles, error: vehiclesError }] = await Promise.all([
      supabase
        .from('agent_documents')
        .select(
          'id, profile_id, doc_type, storage_path, verification_status, verified_at, created_at, ' +
            'profiles(first_name, last_name, phone_number, is_agent_verified)',
        )
        .order('created_at', { ascending: true }),
      supabase.from('agent_vehicles').select('profile_id, vehicle_type, created_at').order('created_at', { ascending: false }),
    ]);
    if (docsError) {
      setLoadError(docsError.message);
      setDocuments([]);
      return;
    }
    setDocuments((docs ?? []) as unknown as AgentDocument[]);

    if (!vehiclesError) {
      const byProfile: Record<string, VehicleType> = {};
      for (const v of vehicles ?? []) {
        // Rows are ordered newest-first, so the first one seen per profile
        // is that agent's current declared vehicle.
        if (!(v.profile_id in byProfile)) byProfile[v.profile_id] = v.vehicle_type as VehicleType;
      }
      setVehicleTypeByProfile(byProfile);
    }
  }, []);

  useEffect(() => {
    async function startLoading() {
      await load();
    }
    startLoading();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const groups = useMemo<AgentGroup[] | null>(() => {
    if (!documents) return null;
    const byProfile = new Map<string, AgentGroup>();
    for (const doc of documents) {
      const existing = byProfile.get(doc.profile_id);
      if (existing) {
        existing.documents.push(doc);
        continue;
      }
      byProfile.set(doc.profile_id, {
        profileId: doc.profile_id,
        firstName: doc.profiles?.first_name ?? 'Unknown',
        lastName: doc.profiles?.last_name ?? '',
        phoneNumber: doc.profiles?.phone_number ?? null,
        isAgentVerified: (doc.profiles as { is_agent_verified?: boolean } | null)?.is_agent_verified ?? false,
        documents: [doc],
      });
    }
    return Array.from(byProfile.values());
  }, [documents]);

  const visibleGroups = useMemo(() => {
    if (!groups) return null;
    if (tab === 'all') return groups;
    return groups.filter((g) => g.documents.some((d) => d.verification_status === tab));
  }, [groups, tab]);

  function readinessFor(group: AgentGroup) {
    const byType = new Map(group.documents.map((d) => [d.doc_type, d]));
    const vehicleType = vehicleTypeByProfile[group.profileId] ?? 'none';
    const requiredTypes = vehicleType === 'none' ? REQUIRED_DOC_TYPES.filter((t) => t !== 'vehicle_rc') : REQUIRED_DOC_TYPES;
    const missing = requiredTypes.filter((t) => byType.get(t)?.verification_status !== 'verified');
    return { ready: missing.length === 0, missing };
  }

  function toggleExpanded(profileId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  async function toggleImage(doc: AgentDocument) {
    if (signedUrls[doc.id] !== undefined) {
      setSignedUrls((prev) => {
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
      return;
    }
    setLoadingImageDocId(doc.id);
    const url = await getSignedUrl('agent-documents', doc.storage_path);
    setLoadingImageDocId(null);
    setSignedUrls((prev) => ({ ...prev, [doc.id]: url }));
  }

  async function setDocStatus(doc: AgentDocument, status: 'verified' | 'rejected') {
    setActionError(null);
    setBusyDocId(doc.id);
    const verifiedAt = new Date().toISOString();
    const { error } = await supabase
      .from('agent_documents')
      .update({ verification_status: status, verified_at: verifiedAt })
      .eq('id', doc.id);
    setBusyDocId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    setDocuments((prev) =>
      prev
        ? prev.map((d) => (d.id === doc.id ? { ...d, verification_status: status, verified_at: verifiedAt } : d))
        : prev,
    );
  }

  async function setAgentVerified(group: AgentGroup, verified: boolean) {
    setActionError(null);
    setBusyProfileId(group.profileId);
    const { error } = await supabase.from('profiles').update({ is_agent_verified: verified }).eq('id', group.profileId);
    setBusyProfileId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    setDocuments((prev) =>
      prev
        ? prev.map((d) =>
            d.profile_id === group.profileId && d.profiles
              ? { ...d, profiles: { ...d.profiles, is_agent_verified: verified } as AgentDocument['profiles'] }
              : d,
          )
        : prev,
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">KYC Queue</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mt-4 flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition ${
              tab === t.value ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}

      <div className="mt-4 space-y-3">
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>
        )}

        {visibleGroups === null && !loadError && <p className="text-sm text-gray-500">Loading…</p>}

        {visibleGroups?.length === 0 && (
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
            No agents in this view.
          </p>
        )}

        {visibleGroups?.map((group) => {
          const isExpanded = expanded.has(group.profileId);
          const readiness = readinessFor(group);
          const pendingCount = group.documents.filter((d) => d.verification_status === 'pending').length;

          return (
            <div key={group.profileId} className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                onClick={() => toggleExpanded(group.profileId)}
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      {group.firstName} {group.lastName}
                    </span>
                    {group.isAgentVerified && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                        Verified agent
                      </span>
                    )}
                    {!group.isAgentVerified && readiness.ready && (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
                        Ready to approve
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {group.phoneNumber ?? 'No phone on file'} · {group.documents.length} document
                    {group.documents.length === 1 ? '' : 's'}
                    {pendingCount > 0 && ` · ${pendingCount} pending`}
                  </p>
                </div>
                <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3">
                    <p className="text-sm text-gray-600">
                      {readiness.ready
                        ? 'Aadhaar, driving licence' +
                          (vehicleTypeByProfile[group.profileId] && vehicleTypeByProfile[group.profileId] !== 'none'
                            ? ', and vehicle RC'
                            : '') +
                          ' are all verified.'
                        : `Still missing verified: ${readiness.missing.map((t) => DOC_TYPE_LABEL[t]).join(', ')}.`}
                    </p>
                    <button
                      onClick={() => setAgentVerified(group, !group.isAgentVerified)}
                      disabled={busyProfileId === group.profileId}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                        group.isAgentVerified
                          ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                          : 'bg-brand text-white hover:bg-brand-hover'
                      }`}
                    >
                      {busyProfileId === group.profileId
                        ? 'Saving…'
                        : group.isAgentVerified
                          ? 'Revoke agent approval'
                          : 'Approve agent'}
                    </button>
                  </div>

                  <ul className="mt-4 space-y-3">
                    {group.documents.map((doc) => (
                      <li key={doc.id} className="rounded-lg border border-gray-200 px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{DOC_TYPE_LABEL[doc.doc_type]}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[doc.verification_status]}`}>
                              {doc.verification_status}
                            </span>
                          </div>
                          <span className="text-xs text-gray-400">Submitted {formatDate(doc.created_at)}</span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => toggleImage(doc)}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-100"
                          >
                            {loadingImageDocId === doc.id
                              ? 'Loading…'
                              : signedUrls[doc.id] !== undefined
                                ? 'Hide document'
                                : 'View document'}
                          </button>
                          <button
                            onClick={() => setDocStatus(doc, 'verified')}
                            disabled={busyDocId === doc.id || doc.verification_status === 'verified'}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setDocStatus(doc, 'rejected')}
                            disabled={busyDocId === doc.id || doc.verification_status === 'rejected'}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>

                        {signedUrls[doc.id] !== undefined && (
                          <div className="mt-3">
                            {signedUrls[doc.id] ? (
                              <img
                                src={signedUrls[doc.id] as string}
                                alt={`${DOC_TYPE_LABEL[doc.doc_type]} submitted by ${group.firstName} ${group.lastName}`}
                                className="max-h-96 rounded-lg border border-gray-200 object-contain"
                              />
                            ) : (
                              <p className="text-xs text-red-600">Couldn't load this document's image.</p>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
