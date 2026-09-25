-- Fixes a bug where re-accepting an order after an agent cancellation
-- (agent_cancel_order, migration 49) crashed with:
--   duplicate key value violates unique constraint "fee_charges_order_id_fee_type_key"
--
-- Root cause: charge_order_fee() plain-INSERTed into fee_charges, which has
-- a unique (order_id, fee_type) constraint. The first acceptance inserts a
-- row for (order_id, 'agent_accept'); agent_cancel_order reopens the order
-- but never cleans up that row; the next acceptance (same or a different
-- agent) tries to insert a second row for the same (order_id, 'agent_accept')
-- pair and violates the constraint, rolling back the whole accept.
--
-- Fix: make all three inserts in charge_order_fee() upsert on
-- (order_id, fee_type) conflict, so a re-acceptance replaces the stale,
-- now-void charge instead of colliding with it.
--
-- Known follow-up (not fixed here): the free-tier counter
-- (orders_accepted_count / orders_posted_count) still increments on every
-- call, including a re-accept after a cancellation — so an agent who
-- repeatedly cancels and re-accepts the same order burns through their
-- "first 3 free" quota faster than intended. Left as-is pending a product
-- decision on whether that should be corrected.

create or replace function public.charge_order_fee(
  p_order_id uuid, p_profile_id uuid, p_fee_type public.fee_type
)
returns public.fee_charges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counter_column text := case p_fee_type
    when 'customer_post' then 'orders_posted_count'
    when 'agent_accept' then 'orders_accepted_count'
  end;
  v_current_count integer;
  v_wallet_balance integer;
  v_charge public.fee_charges;
begin
  execute format('select %I from public.profiles where id = $1', v_counter_column)
    into v_current_count using p_profile_id;

  execute format('update public.profiles set %I = %I + 1 where id = $1', v_counter_column, v_counter_column)
    using p_profile_id;

  if v_current_count < 3 then
    insert into public.fee_charges (profile_id, order_id, fee_type, amount_paise, source, status, paid_at)
    values (p_profile_id, p_order_id, p_fee_type, 0, 'waived_free_tier', 'waived', now())
    on conflict (order_id, fee_type) do update set
      profile_id = excluded.profile_id,
      amount_paise = excluded.amount_paise,
      source = excluded.source,
      status = excluded.status,
      razorpay_order_id = null,
      paid_at = excluded.paid_at,
      created_at = now()
    returning * into v_charge;
    return v_charge;
  end if;

  select wallet_balance_paise into v_wallet_balance from public.profiles where id = p_profile_id;

  if v_wallet_balance >= 299 then
    update public.profiles set wallet_balance_paise = wallet_balance_paise - 299 where id = p_profile_id;
    insert into public.wallet_transactions (profile_id, amount_paise, type, related_order_id)
    values (p_profile_id, -299, 'commission_payment', p_order_id);
    insert into public.fee_charges (profile_id, order_id, fee_type, amount_paise, source, status, paid_at)
    values (p_profile_id, p_order_id, p_fee_type, 299, 'wallet', 'paid', now())
    on conflict (order_id, fee_type) do update set
      profile_id = excluded.profile_id,
      amount_paise = excluded.amount_paise,
      source = excluded.source,
      status = excluded.status,
      razorpay_order_id = null,
      paid_at = excluded.paid_at,
      created_at = now()
    returning * into v_charge;
    return v_charge;
  end if;

  insert into public.fee_charges (profile_id, order_id, fee_type, amount_paise, status)
  values (p_profile_id, p_order_id, p_fee_type, 299, 'pending')
  on conflict (order_id, fee_type) do update set
    profile_id = excluded.profile_id,
    amount_paise = excluded.amount_paise,
    status = excluded.status,
    source = null,
    razorpay_order_id = null,
    paid_at = null,
    created_at = now()
  returning * into v_charge;
  return v_charge;
end;
$$;
