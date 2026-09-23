-- Referral system: tiered wallet credit for the referrer (₹20 / ₹30 / ₹50 for
-- their 1st/2nd/3rd successful referral, nothing after), rewarded only once
-- the invitee's first order is delivered. Wallet only ever covers Gen-D's own
-- commission — the full order amount still moves directly customer-to-agent.

alter table public.profiles
  add column wallet_balance_paise integer not null default 0;

create type public.referral_status as enum ('pending', 'rewarded', 'blocked', 'capped');

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id),
  invitee_id uuid not null unique references public.profiles(id),
  referral_code_used text not null,
  status public.referral_status not null default 'pending',
  reward_paise integer not null default 0,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  blocked_reason text,
  check (referrer_id <> invitee_id)
);
create index referrals_referrer_id_idx on public.referrals(referrer_id);

create type public.wallet_txn_type as enum ('referral_credit', 'commission_payment', 'admin_adjustment');

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  amount_paise integer not null,
  type public.wallet_txn_type not null,
  related_order_id uuid references public.orders(id),
  related_referral_id uuid references public.referrals(id),
  created_at timestamptz not null default now()
);
create index wallet_transactions_profile_id_idx on public.wallet_transactions(profile_id);

alter table public.referrals enable row level security;
alter table public.wallet_transactions enable row level security;

create policy "referrals: referrer can view their own"
  on public.referrals for select using (auth.uid() = referrer_id);

create policy "wallet_transactions: profile can view their own"
  on public.wallet_transactions for select using (auth.uid() = profile_id);

create or replace function public.record_referral_signup(p_referral_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_invitee_id uuid := auth.uid();
begin
  if v_invitee_id is null then
    return;
  end if;

  select id into v_referrer_id
  from public.profiles
  where upper(left(replace(id::text, '-', ''), 8)) = upper(p_referral_code)
  limit 1;

  if v_referrer_id is null or v_referrer_id = v_invitee_id then
    return;
  end if;

  insert into public.referrals (referrer_id, invitee_id, referral_code_used)
  values (v_referrer_id, v_invitee_id, p_referral_code)
  on conflict (invitee_id) do nothing;
end;
$$;
grant execute on function public.record_referral_signup(text) to authenticated;

create or replace function public.process_referral_reward()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral record;
  v_prior_delivered_count integer;
  v_referrer_phone text;
  v_invitee_phone text;
  v_shared_push_token boolean;
  v_prior_rewarded_count integer;
  v_tier_amount integer;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then
    return new;
  end if;

  select * into v_referral from public.referrals
  where invitee_id = new.customer_id and status = 'pending' limit 1;
  if v_referral.id is null then
    return new;
  end if;

  select count(*) into v_prior_delivered_count
  from public.orders where customer_id = new.customer_id and status = 'delivered';
  if v_prior_delivered_count <> 1 then
    return new;
  end if;

  select phone_number into v_referrer_phone from public.profiles where id = v_referral.referrer_id;
  select phone_number into v_invitee_phone from public.profiles where id = v_referral.invitee_id;

  select exists (
    select 1 from public.push_tokens pt1
    join public.push_tokens pt2 on pt1.expo_push_token = pt2.expo_push_token
    where pt1.profile_id = v_referral.referrer_id and pt2.profile_id = v_referral.invitee_id
  ) into v_shared_push_token;

  if (v_referrer_phone is not null and v_referrer_phone = v_invitee_phone) or v_shared_push_token then
    update public.referrals set status = 'blocked',
      blocked_reason = 'Referrer and invitee share a phone number or device.'
    where id = v_referral.id;
    return new;
  end if;

  select count(*) into v_prior_rewarded_count
  from public.referrals where referrer_id = v_referral.referrer_id and status = 'rewarded';

  v_tier_amount := case v_prior_rewarded_count
    when 0 then 2000
    when 1 then 3000
    when 2 then 5000
    else null
  end;

  if v_tier_amount is null then
    update public.referrals set status = 'capped' where id = v_referral.id;
    return new;
  end if;

  update public.profiles set wallet_balance_paise = wallet_balance_paise + v_tier_amount
  where id = v_referral.referrer_id;

  insert into public.wallet_transactions (profile_id, amount_paise, type, related_order_id, related_referral_id)
  values (v_referral.referrer_id, v_tier_amount, 'referral_credit', new.id, v_referral.id);

  update public.referrals set status = 'rewarded', rewarded_at = now(), reward_paise = v_tier_amount
  where id = v_referral.id;

  return new;
end;
$$;

create trigger orders_process_referral_reward
  after update of status on public.orders
  for each row execute function public.process_referral_reward();
