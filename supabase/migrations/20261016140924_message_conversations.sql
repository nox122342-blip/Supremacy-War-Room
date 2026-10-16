create function public.list_message_conversations(p_user_id uuid)
returns table (
  user_id uuid,
  username text,
  last_message text,
  last_message_at timestamptz,
  unread bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with latest as (
    select distinct on (
      case when m.sender_id = p_user_id then m.recipient_id else m.sender_id end
    )
      case when m.sender_id = p_user_id then m.recipient_id else m.sender_id end as other_id,
      m.body,
      m.created_at,
      m.id
    from public.messages m
    where m.sender_id = p_user_id or m.recipient_id = p_user_id
    order by
      case when m.sender_id = p_user_id then m.recipient_id else m.sender_id end,
      m.created_at desc,
      m.id desc
  ),
  unread_counts as (
    select sender_id, count(*) as unread
    from public.messages
    where recipient_id = p_user_id and read_at is null
    group by sender_id
  )
  select latest.other_id, u.username, latest.body, latest.created_at,
         coalesce(unread_counts.unread, 0)
  from latest
  join public.users u on u.id = latest.other_id and u.is_demo = false
  left join unread_counts on unread_counts.sender_id = latest.other_id
  order by latest.created_at desc, latest.id desc;
$$;

revoke all on function public.list_message_conversations(uuid)
from public, anon, authenticated;
grant execute on function public.list_message_conversations(uuid)
to service_role;
