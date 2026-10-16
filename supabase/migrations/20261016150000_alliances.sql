create table public.alliances (
  id uuid primary key,
  name text not null check (char_length(name) between 3 and 32),
  owner_id uuid not null references public.users (id),
  created_at timestamptz not null default now()
);

create unique index idx_alliances_name_lower on public.alliances (lower(name));

create table public.alliance_members (
  alliance_id uuid not null references public.alliances (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (alliance_id, user_id),
  unique (user_id)
);

create index idx_alliance_members_joined on public.alliance_members (alliance_id, joined_at);

alter table public.alliances enable row level security;
alter table public.alliance_members enable row level security;
revoke all on table public.alliances, public.alliance_members from public, anon, authenticated;
grant all on table public.alliances, public.alliance_members to service_role;

-- Each function returns a status: ok, name_taken, already_member, not_found, full, not_member.
create function public.create_alliance(p_id uuid, p_user_id uuid, p_name text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if exists (select 1 from alliance_members where user_id = p_user_id) then
    return 'already_member';
  end if;
  insert into alliances (id, name, owner_id) values (p_id, p_name, p_user_id);
  insert into alliance_members (alliance_id, user_id) values (p_id, p_user_id);
  return 'ok';
exception
  when unique_violation then
    if exists (select 1 from alliance_members where user_id = p_user_id) then
      return 'already_member';
    end if;
    return 'name_taken';
end;
$$;

create function public.join_alliance(p_alliance_id uuid, p_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Locking the alliance row serialises concurrent joins so the 128 cap is exact.
  perform 1 from alliances where id = p_alliance_id for update;
  if not found then
    return 'not_found';
  end if;
  if exists (select 1 from alliance_members where user_id = p_user_id) then
    return 'already_member';
  end if;
  if (select count(*) from alliance_members where alliance_id = p_alliance_id) >= 128 then
    return 'full';
  end if;
  insert into alliance_members (alliance_id, user_id) values (p_alliance_id, p_user_id);
  return 'ok';
exception
  when unique_violation then
    return 'already_member';
end;
$$;

create function public.leave_alliance(p_user_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_alliance uuid;
  v_owner uuid;
  v_next uuid;
begin
  select alliance_id into v_alliance from alliance_members where user_id = p_user_id;
  if v_alliance is null then
    return 'not_member';
  end if;
  select owner_id into v_owner from alliances where id = v_alliance for update;
  delete from alliance_members where user_id = p_user_id;
  select user_id into v_next from alliance_members
    where alliance_id = v_alliance order by joined_at, user_id limit 1;
  if v_next is null then
    delete from alliances where id = v_alliance;
  elsif v_owner = p_user_id then
    update alliances set owner_id = v_next where id = v_alliance;
  end if;
  return 'ok';
end;
$$;

create function public.list_alliances(p_query text, p_limit integer)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  created_at timestamptz,
  member_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id, a.name, a.owner_id, a.created_at, count(m.user_id)
  from alliances a
  left join alliance_members m on m.alliance_id = a.id
  where p_query is null or a.name ilike '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  group by a.id
  order by count(m.user_id) desc, a.name
  limit p_limit;
$$;

revoke all on function public.create_alliance(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.join_alliance(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_alliance(uuid) from public, anon, authenticated;
revoke all on function public.list_alliances(text, integer) from public, anon, authenticated;
grant execute on function public.create_alliance(uuid, uuid, text) to service_role;
grant execute on function public.join_alliance(uuid, uuid) to service_role;
grant execute on function public.leave_alliance(uuid) to service_role;
grant execute on function public.list_alliances(text, integer) to service_role;
