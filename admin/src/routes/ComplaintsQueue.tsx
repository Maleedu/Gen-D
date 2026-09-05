import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getSignedUrl } from '../lib/signedUrl';
import type { Complaint, ComplaintStatus } from '../lib/types';

const TABS: { value: ComplaintStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const ALL_STATUSES: ComplaintStatus[] = ['open', 'investigating', 'resolved', 'dismissed'];

const STATUS_BADGE: Record<ComplaintStatus, string> = {
  open: 'bg-amber-100 text-amber-800',
  investigating: 'bg-blue-100 text-blue-800',
  resolved: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-200 text-gray-700',
};

const STATUS_ACTION_LABEL: Record<ComplaintStatus, string> = {
  open: 'Reopen',
  investigating: 'Investigate',
  resolved: 'Resolve',
  dismissed: 'Dismiss',
};

type OrderContext = {
  item_description: string;
  point_a_address: string;
  point_b_address: string;
  status: string;
};

type RaiserProfile = { first_name: string; last_name: string };

type Evidence = {
  hasPhoto: boolean;
  signedPhotoUrl: string | null;
  sealStatus: string | null;
  sealVerifiedAt: string | null;
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ComplaintsQueue() {
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [ordersById, setOrdersById] = useState<Record<string, OrderContext>>({});
  const [raisersById, setRaisersById] = useState<Record<string, RaiserProfile>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<ComplaintStatus>('open');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evidenceByComplaint, setEvidenceByComplaint] = useState<Record<string, Evidence>>({});
  const [loadingEvidenceId, setLoadingEvidenceId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from('complaints')
      .select('id, order_id, raised_by, reason, status, created_at')
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setComplaints([]);
      return;
    }
    const rows = (data ?? []) as Complaint[];
    setComplaints(rows);

    // Order/customer context isn't in the doc's base query, but a bare
    // order_id/raised_by uuid isn't enough for an admin to act on — pull
    // both in bulk for whatever complaints just loaded.
    const orderIds = Array.from(new Set(rows.map((c) => c.order_id)));
    const raiserIds = Array.from(new Set(rows.map((c) => c.raised_by)));
    const [{ data: orders }, { data: raisers }] = await Promise.all([
      orderIds.length
        ? supabase
            .from('orders')
            .select('id, item_description, point_a_address, point_b_address, status')
            .in('id', orderIds)
        : Promise.resolve({ data: [] as ({ id: string } & OrderContext)[] }),
      raiserIds.length
        ? supabase.from('profiles').select('id, first_name, last_name').in('id', raiserIds)
        : Promise.resolve({ data: [] as ({ id: string } & RaiserProfile)[] }),
    ]);
    setOrdersById(Object.fromEntries((orders ?? []).map((o) => [o.id, o])));
    setRaisersById(Object.fromEntries((raisers ?? []).map((r) => [r.id, r])));
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

  const visibleComplaints = useMemo(() => {
    if (!complaints) return null;
    return complaints.filter((c) => c.status === tab);
  }, [complaints, tab]);

  async function toggleExpanded(complaint: Complaint) {
    if (expandedId === complaint.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(complaint.id);
    if (evidenceByComplaint[complaint.id]) return;

    setLoadingEvidenceId(complaint.id);
    const [{ data: photo }, { data: seal }] = await Promise.all([
      supabase.from('delivery_photos').select('photo_url').eq('order_id', complaint.order_id).maybeSingle(),
      supabase.from('delivery_verifications').select('seal_status, verified_at').eq('order_id', complaint.order_id).maybeSingle(),
    ]);
    const signedPhotoUrl = photo?.photo_url ? await getSignedUrl('delivery-photos', photo.photo_url) : null;
    setLoadingEvidenceId(null);
    setEvidenceByComplaint((prev) => ({
      ...prev,
      [complaint.id]: {
        hasPhoto: !!photo,
        signedPhotoUrl,
        sealStatus: seal?.seal_status ?? null,
        sealVerifiedAt: seal?.verified_at ?? null,
      },
    }));
  }

  async function setStatus(complaint: Complaint, newStatus: ComplaintStatus) {
    setActionError(null);
    setBusyId(complaint.id);
    const { error } = await supabase.from('complaints').update({ status: newStatus }).eq('id', complaint.id);
    setBusyId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    setComplaints((prev) => (prev ? prev.map((c) => (c.id === complaint.id ? { ...c, status: newStatus } : c)) : prev));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Complaints Queue</h1>
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

        {visibleComplaints === null && !loadError && <p className="text-sm text-gray-500">Loading…</p>}

        {visibleComplaints?.length === 0 && (
          <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
            No complaints in this view.
          </p>
        )}

        {visibleComplaints?.map((complaint) => {
          const order = ordersById[complaint.order_id];
          const raiser = raisersById[complaint.raised_by];
          const isExpanded = expandedId === complaint.id;
          const evidence = evidenceByComplaint[complaint.id];

          return (
            <div key={complaint.id} className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                onClick={() => toggleExpanded(complaint)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[complaint.status]}`}>
                      {complaint.status}
                    </span>
                    <span className="truncate text-sm font-medium text-gray-900">{complaint.reason}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {order ? `${order.point_a_address} → ${order.point_b_address}` : `Order ${complaint.order_id}`}
                    {' · Raised by '}
                    {raiser ? `${raiser.first_name} ${raiser.last_name}` : complaint.raised_by}
                    {' · '}
                    {formatDateTime(complaint.created_at)}
                  </p>
                </div>
                <span className="shrink-0 text-gray-400">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-4">
                  {order && (
                    <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                      <p className="font-medium">{order.item_description}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {order.point_a_address} → {order.point_b_address} · Order status: {order.status}
                      </p>
                    </div>
                  )}

                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Evidence</p>
                    {loadingEvidenceId === complaint.id && <p className="mt-2 text-sm text-gray-500">Loading…</p>}
                    {evidence && (
                      <div className="mt-2 space-y-2">
                        {evidence.sealStatus ? (
                          <p className="text-sm text-gray-700">
                            Seal check:{' '}
                            <span className={evidence.sealStatus === 'broken' ? 'font-semibold text-red-600' : 'font-semibold text-green-700'}>
                              {evidence.sealStatus}
                            </span>
                            {evidence.sealVerifiedAt && ` · ${formatDateTime(evidence.sealVerifiedAt)}`}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-500">No seal check on file for this order.</p>
                        )}
                        {evidence.hasPhoto ? (
                          evidence.signedPhotoUrl ? (
                            <img
                              src={evidence.signedPhotoUrl}
                              alt="Delivery photo submitted for this order"
                              className="max-h-96 rounded-lg border border-gray-200 object-contain"
                            />
                          ) : (
                            <p className="text-xs text-red-600">Couldn't load the delivery photo.</p>
                          )
                        ) : (
                          <p className="text-sm text-gray-500">No delivery photo on file for this order.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {ALL_STATUSES.filter((s) => s !== complaint.status).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(complaint, s)}
                        disabled={busyId === complaint.id}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                      >
                        {busyId === complaint.id ? 'Saving…' : STATUS_ACTION_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
