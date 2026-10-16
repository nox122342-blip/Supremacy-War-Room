create table public.users (
  id uuid primary key,
  username text not null,
  password_hash text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index idx_users_username_lower on public.users (lower(username));

create table public.strategies (
  id uuid primary key,
  user_id uuid not null references public.users (id),
  title text not null,
  faction text not null,
  theatre text not null default 'global',
  category text not null check (category in ('Economy', 'Warfare', 'Diplomacy', 'Logistics')),
  phase text not null check (phase in ('Early', 'Mid', 'Late')),
  summary text not null,
  steps_json jsonb not null,
  tags_json jsonb not null,
  rating integer not null default 88,
  shares integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.priorities (
  id uuid primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key,
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  user_id uuid not null references public.users (id),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key,
  sender_id uuid not null references public.users (id),
  recipient_id uuid not null references public.users (id),
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.sessions (
  sid text primary key,
  sess jsonb not null,
  expire bigint not null
);

create index idx_strategies_created on public.strategies (created_at desc);
create index idx_strategies_user on public.strategies (user_id);
create index idx_priorities_user on public.priorities (user_id, created_at);
create index idx_comments_strategy on public.comments (strategy_id, created_at);
create index idx_messages_conversation on public.messages (sender_id, recipient_id, created_at);
create index idx_sessions_expire on public.sessions (expire);

create view public.strategy_feed
with (security_invoker = true)
as
select
  s.id,
  s.user_id,
  s.title,
  s.faction,
  s.theatre,
  s.category,
  s.phase,
  s.summary,
  s.steps_json,
  s.tags_json,
  s.rating,
  s.shares,
  s.created_at,
  u.username as author,
  (select count(*) from public.comments c where c.strategy_id = s.id) as comment_count
from public.strategies s
join public.users u on u.id = s.user_id
where u.is_demo = false;

create function public.search_strategy_feed(
  p_query text,
  p_category text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select *
    from public.strategy_feed
    where (p_category is null or category = p_category)
      and (
        nullif(p_query, '') is null
        or strpos(
          lower(concat_ws(' ', title, summary, faction, tags_json::text, author)),
          lower(p_query)
        ) > 0
      )
  ),
  page as (
    select *
    from filtered
    order by created_at desc, id desc
    limit greatest(1, least(coalesce(p_limit, 24), 50))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'strategies', coalesce(
      (select jsonb_agg(to_jsonb(page) order by created_at desc, id desc) from page),
      '[]'::jsonb
    ),
    'total', (select count(*) from filtered)
  );
$$;

create function public.create_priority(
  p_id uuid,
  p_user_id uuid,
  p_body text
)
returns public.priorities
language plpgsql
security invoker
set search_path = public
as $$
declare
  priority_count integer;
  created_priority public.priorities;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select count(*) into priority_count
  from public.priorities
  where user_id = p_user_id;

  if priority_count >= 10 then
    raise exception using errcode = 'P0001', message = 'PRIORITY_LIMIT_REACHED';
  end if;

  insert into public.priorities (id, user_id, body)
  values (p_id, p_user_id, p_body)
  returning * into created_priority;

  return created_priority;
end;
$$;

alter table public.users enable row level security;
alter table public.strategies enable row level security;
alter table public.priorities enable row level security;
alter table public.comments enable row level security;
alter table public.messages enable row level security;
alter table public.sessions enable row level security;

revoke all on table
  public.users,
  public.strategies,
  public.priorities,
  public.comments,
  public.messages,
  public.sessions
from public, anon, authenticated;

revoke all on public.strategy_feed from public, anon, authenticated;
grant select on public.strategy_feed to service_role;

revoke all on function public.search_strategy_feed(text, text, integer, integer)
from public, anon, authenticated;
grant execute on function public.search_strategy_feed(text, text, integer, integer)
to service_role;

revoke all on function public.create_priority(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.create_priority(uuid, uuid, text)
to service_role;

grant all on table
  public.users,
  public.strategies,
  public.priorities,
  public.comments,
  public.messages,
  public.sessions
to service_role;
