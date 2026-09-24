-- Fee model: first 3 orders free per account (posting for customers,
-- accepting for agents), then ₹2.99 per order after that. Wallet balance
-- covers the fee first; any shortfall is settled via Razorpay UPI.

alter table public.profiles
  add column orders_posted_count integer not null default 0,
  add column orders_accepted_count integer not null default 0;

-- Replaces the old platform_fee_transactions table entirely (0 rows —
-- shaped for the abandoned flat pay-per-accept model, per your own notes).
drop table if exists public.platform_fee_transactions;

create type public.fee_type as enum ('customer_post', 'agent_accept');
create type public.fee_source as enum ('waived_free_tier', 'wallet', 'razorpay');
create type public.fee_charge_status as enum ('waived', 'paid', 'pending', 'failed');

create table public.fee_charges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  fee_type public.fee_type not null,
  amount_paise integer not null default 299,
  source public.fee_source,
  status public.fee_charge_status not null default 'pending',
  razorpay_order_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (order_id, fee_type)
);
create index fee_charges_profile_id_idx on public.fee_charges(profile_id);
create index fee_charges_razorpay_order_id_idx on public.fee_charges(razorpay_order_id);

alter table public.fee_charges enable row level security;
create policy "fee_charges: profile can view their own"
  on public.fee_charges for select using (auth.uid() = profile_id);

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
    returning * into v_charge;
    return v_charge;
  end if;

  insert into public.fee_charges (profile_id, order_id, fee_type, amount_paise, status)
  values (p_profile_id, p_order_id, p_fee_type, 299, 'pending')
  returning * into v_charge;
  return v_charge;
end;
$$;

create or replace function public.trigger_customer_post_fee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.charge_order_fee(new.id, new.customer_id, 'customer_post');
  return new;
end;
$$;
create trigger orders_customer_post_fee
  after insert on public.orders
  for each row execute function public.trigger_customer_post_fee();

create or replace function public.trigger_agent_accept_fee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accepted_agent_id is not null and old.accepted_agent_id is null then
    perform public.charge_order_fee(new.id, new.accepted_agent_id, 'agent_accept');
  end if;
  return new;
end;
$$;
create trigger orders_agent_accept_fee
  after update of accepted_agent_id on public.orders
  for each row execute function public.trigger_agent_accept_fee();
