-- Furina Reader — initial schema
-- Every user-owned table is protected by Row Level Security: a user can only
-- see and modify rows where user_id = auth.uid().

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: owner read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: owner update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)), 40))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- sync tables
-- All synced entities share one shape: the client's record as JSONB plus
-- client-side updated_at (ms, used for conflict resolution) and a server
-- timestamp used as the pull cursor.
create or replace function public.touch_server_updated_at() returns trigger
language plpgsql as $$ begin new.server_updated_at := clock_timestamp(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['library_titles','library_chapters','reading_progress','reading_history','collections','user_settings'] loop
    execute format($f$
      create table if not exists public.%1$I (
        user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
        id text not null check (char_length(id) <= 100),
        data jsonb,
        deleted boolean not null default false,
        updated_at bigint not null,
        server_updated_at timestamptz not null default clock_timestamp(),
        primary key (user_id, id),
        constraint %1$s_data_size check (data is null or pg_column_size(data) < 65536)
      );
      create index if not exists %1$s_cursor on public.%1$I (user_id, server_updated_at);
      alter table public.%1$I enable row level security;
      drop policy if exists "%1$s: owner select" on public.%1$I;
      drop policy if exists "%1$s: owner insert" on public.%1$I;
      drop policy if exists "%1$s: owner update" on public.%1$I;
      drop policy if exists "%1$s: owner delete" on public.%1$I;
      create policy "%1$s: owner select" on public.%1$I for select using (auth.uid() = user_id);
      create policy "%1$s: owner insert" on public.%1$I for insert with check (auth.uid() = user_id);
      create policy "%1$s: owner update" on public.%1$I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
      create policy "%1$s: owner delete" on public.%1$I for delete using (auth.uid() = user_id);
      drop trigger if exists %1$s_touch on public.%1$I;
      create trigger %1$s_touch before insert or update on public.%1$I for each row execute function public.touch_server_updated_at();
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- devices
create table if not exists public.devices (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  device_id text not null check (char_length(device_id) <= 64),
  name text not null check (char_length(name) <= 60),
  platform text not null check (platform in ('web','windows','android')),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.devices enable row level security;
create policy "devices: owner all" on public.devices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- AI usage (rate limiting)
-- Written only by the ai-assistant edge function (service role). Users may read their own usage.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  requests int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy "ai_usage: owner read" on public.ai_usage for select using (auth.uid() = user_id);

create or replace function public.ai_take_quota(p_user uuid, p_limit int) returns int
language plpgsql security definer set search_path = public as $$
declare used int;
begin
  insert into public.ai_usage (user_id, day, requests) values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set requests = public.ai_usage.requests + 1
  returning requests into used;
  return case when used > p_limit then -1 else p_limit - used end;
end $$;
revoke all on function public.ai_take_quota(uuid, int) from public, anon, authenticated;
