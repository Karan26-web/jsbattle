-- ============================================================================
-- JSBattle — Supabase schema
--
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: every statement is idempotent.
--
-- After running, go to Authentication -> Providers -> Email and turn OFF
-- "Confirm email" if you want players to be able to sign up and play
-- immediately. Leave it on and they will need to click a link first (the app
-- handles both cases).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text unique not null check (char_length(username) between 2 and 24),
  created_at timestamptz not null default now()
);

-- One row per (player, level): their personal best, never a history.
-- The unique constraint is what makes submit_score's upsert work.
create table if not exists public.scores (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  level_slug  text not null,
  score       int  not null check (score between 0 and 1000),
  char_count  int  not null check (char_count >= 0),
  meta        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  unique (user_id, level_slug)
);

create index if not exists scores_level_slug_score_idx
  on public.scores (level_slug, score desc, char_count asc);

-- ----------------------------------------------------------------------------
-- Auto-create a profile when someone signs up.
--
-- The username comes from the signUp() metadata. If it collides with an
-- existing one we append a counter rather than failing the whole signup.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base  text;
  final text;
  n     int := 0;
begin
  base := coalesce(nullif(trim(new.raw_user_meta_data ->> 'username'), ''), 'player');
  base := left(regexp_replace(base, '[^a-zA-Z0-9_]', '', 'g'), 20);
  if char_length(base) < 2 then
    base := 'player';
  end if;

  final := base;
  while exists (select 1 from public.profiles where username = final) loop
    n := n + 1;
    final := base || n::text;
  end loop;

  insert into public.profiles (id, username) values (new.id, final);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- Everything is world-readable (it is a public leaderboard) but only ever
-- writable by its owner.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.scores   enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "scores are readable by everyone" on public.scores;
create policy "scores are readable by everyone"
  on public.scores for select using (true);

drop policy if exists "users insert their own scores" on public.scores;
create policy "users insert their own scores"
  on public.scores for insert with check (auth.uid() = user_id);

drop policy if exists "users update their own scores" on public.scores;
create policy "users update their own scores"
  on public.scores for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- submit_score
--
-- Upsert that refuses to go backwards: a resubmitted or out-of-order lower
-- score leaves the existing best untouched. Always returns the current best
-- row so the client can render the truth rather than what it hoped for.
-- ----------------------------------------------------------------------------
create or replace function public.submit_score(
  p_level_slug text,
  p_score      int,
  p_char_count int,
  p_meta       jsonb default '{}'::jsonb
)
returns public.scores
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.scores;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_score < 0 or p_score > 1000 then
    raise exception 'score out of range';
  end if;

  -- The target is aliased as `s` because ON CONFLICT DO UPDATE can only refer
  -- to the conflicting row through the alias, never a schema-qualified name.
  insert into public.scores as s (user_id, level_slug, score, char_count, meta)
  values (auth.uid(), p_level_slug, p_score, p_char_count, coalesce(p_meta, '{}'::jsonb))
  on conflict (user_id, level_slug) do update
    set score      = excluded.score,
        char_count = excluded.char_count,
        meta       = excluded.meta,
        updated_at = now()
    where excluded.score > s.score
  returning * into result;

  -- The WHERE above suppressed the update (the stored score was already
  -- better or equal), so RETURNING gave us nothing — read the real best back.
  if not found then
    select * into result
    from public.scores
    where user_id = auth.uid() and level_slug = p_level_slug;
  end if;

  return result;
end;
$$;

-- ----------------------------------------------------------------------------
-- Ranking views
--
-- security_invoker keeps the querying user's RLS in force rather than the
-- view owner's. Both underlying tables are publicly readable, so anonymous
-- visitors can browse leaderboards without signing in.
-- ----------------------------------------------------------------------------

drop view if exists public.global_rankings;
create view public.global_rankings
with (security_invoker = on)
as
select
  p.id                                                           as user_id,
  p.username,
  coalesce(sum(s.score), 0)::int                                 as total_xp,
  count(s.id)::int                                               as levels_played,
  rank() over (order by coalesce(sum(s.score), 0) desc)::int     as rank
from public.profiles p
left join public.scores s on s.user_id = p.id
group by p.id, p.username;

drop view if exists public.level_rankings;
create view public.level_rankings
with (security_invoker = on)
as
select
  s.level_slug,
  s.user_id,
  p.username,
  s.score,
  s.char_count,
  s.updated_at,
  rank() over (
    partition by s.level_slug
    order by s.score desc, s.char_count asc
  )::int as rank
from public.scores s
join public.profiles p on p.id = s.user_id;

grant select on public.global_rankings to anon, authenticated;
grant select on public.level_rankings  to anon, authenticated;
