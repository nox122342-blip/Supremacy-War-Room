import session from 'express-session'

const userColumns = 'id, username, created_at, password_hash, is_demo'
const strategyColumns = 'id, user_id, title, faction, theatre, category, phase, summary, steps_json, tags_json, rating, shares, created_at, author, comment_count'

function mapUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
    isDemo: row.is_demo,
  }
}

function mapStrategy(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    faction: row.faction,
    theatre: row.theatre,
    category: row.category,
    phase: row.phase,
    summary: row.summary,
    stepsJson: row.steps_json,
    tagsJson: row.tags_json,
    rating: row.rating,
    shares: row.shares,
    createdAt: row.created_at,
    author: row.author,
    commentCount: Number(row.comment_count ?? 0),
  }
}

function mapPriority(row) {
  return { id: row.id, body: row.body, createdAt: row.created_at }
}

function mapComment(row) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    userId: row.user_id,
    author: row.users.username,
  }
}

function mapMessage(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
  }
}

export function createSupabaseStore(client) {
  return {
    async getUser(id) {
      const { data, error } = await client.from('users')
        .select('id, username, created_at')
        .eq('id', id)
        .eq('is_demo', false)
        .maybeSingle()
      if (error) throw error
      return data ? { id: data.id, username: data.username, createdAt: data.created_at } : null
    },

    async getUserByUsername(username) {
      const escapedUsername = username.replace(/[\\%_]/g, '\\$&')
      const { data, error } = await client.from('users')
        .select(userColumns)
        .ilike('username', escapedUsername)
        .maybeSingle()
      if (error) throw error
      return mapUser(data)
    },

    async createUser({ id, username, passwordHash }) {
      const { data, error } = await client.from('users')
        .insert({ id, username, password_hash: passwordHash })
        .select('id, username, created_at')
        .single()
      if (error) throw error
      return { id: data.id, username: data.username, createdAt: data.created_at }
    },

    async listStrategies({ query, category, limit, offset }) {
      const { data, error } = await client.rpc('search_strategy_feed', {
        p_query: query || null,
        p_category: category || null,
        p_limit: limit,
        p_offset: offset,
      })
      if (error) throw error
      const strategies = (data.strategies || []).map(mapStrategy)
      return {
        strategies,
        total: Number(data.total),
        hasMore: offset + strategies.length < Number(data.total),
      }
    },

    async getStrategy(id) {
      const { data, error } = await client.from('strategy_feed')
        .select(strategyColumns)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return mapStrategy(data)
    },

    async createStrategy(row) {
      const { error } = await client.from('strategies').insert({
        id: row.id,
        user_id: row.userId,
        title: row.title,
        faction: row.faction,
        theatre: row.theatre,
        category: row.category,
        phase: row.phase,
        summary: row.summary,
        steps_json: row.steps,
        tags_json: row.tags,
      })
      if (error) throw error
      return this.getStrategy(row.id)
    },

    async listPriorities(userId) {
      const { data, error } = await client.from('priorities')
        .select('id, body, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return data.map(mapPriority)
    },

    async countPriorities(userId) {
      const { count, error } = await client.from('priorities')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      if (error) throw error
      return count ?? 0
    },

    async createPriority({ id, userId, body }) {
      const { data, error } = await client.rpc('create_priority', {
        p_id: id,
        p_user_id: userId,
        p_body: body,
      })
      if (error) throw error
      return mapPriority(Array.isArray(data) ? data[0] : data)
    },

    async deletePriority(id, userId) {
      const { data, error } = await client.from('priorities')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
      if (error) throw error
      return data.length > 0
    },

    async listComments(strategyId) {
      const { data, error } = await client.from('comments')
        .select('id, body, created_at, user_id, users!comments_user_id_fkey(username)')
        .eq('strategy_id', strategyId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return data.map(mapComment)
    },

    async createComment({ id, strategyId, userId, body }) {
      const { data, error } = await client.from('comments')
        .insert({ id, strategy_id: strategyId, user_id: userId, body })
        .select('id, body, created_at, user_id, users!comments_user_id_fkey(username)')
        .single()
      if (error) throw error
      return mapComment(data)
    },

    async searchUsers(userId, query) {
      const escapedQuery = query.replace(/[\\%_]/g, '\\$&')
      const { data, error } = await client.from('users')
        .select('id, username')
        .neq('id', userId)
        .eq('is_demo', false)
        .ilike('username', `%${escapedQuery}%`)
        .order('username', { ascending: true })
        .limit(10)
      if (error) throw error
      return data
    },

    async listConversations(userId) {
      const { data: messages, error: messagesError } = await client.from('messages')
        .select('id, sender_id, recipient_id, body, created_at, read_at')
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
      if (messagesError) throw messagesError

      const latestByUser = new Map()
      for (const message of messages) {
        const otherUserId = message.sender_id === userId ? message.recipient_id : message.sender_id
        const conversation = latestByUser.get(otherUserId) || { latest: message, unread: 0 }
        conversation.latest = message
        if (message.sender_id === otherUserId && message.recipient_id === userId && message.read_at === null) {
          conversation.unread += 1
        }
        latestByUser.set(otherUserId, conversation)
      }

      const userIds = [...latestByUser.keys()]
      if (userIds.length === 0) return []

      const { data: users, error: usersError } = await client.from('users')
        .select('id, username')
        .in('id', userIds)
        .eq('is_demo', false)
      if (usersError) throw usersError

      const usernames = new Map(users.map((user) => [user.id, user.username]))
      return [...latestByUser.entries()]
        .filter(([id]) => usernames.has(id))
        .map(([id, conversation]) => ({
          userId: id,
          username: usernames.get(id),
          lastMessage: conversation.latest.body,
          lastMessageAt: conversation.latest.created_at,
          unread: conversation.unread,
          latestId: conversation.latest.id,
        }))
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || b.latestId.localeCompare(a.latestId))
        .map(({ latestId: _latestId, ...conversation }) => conversation)
    },

    async listMessages(currentUserId, otherUserId) {
      const { data, error } = await client.from('messages')
        .select('id, sender_id, recipient_id, body, created_at')
        .or(`and(sender_id.eq.${currentUserId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${currentUserId})`)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(200)
      if (error) throw error
      return data.map(mapMessage)
    },

    async markMessagesRead(senderId, recipientId) {
      const { error } = await client.from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('sender_id', senderId)
        .eq('recipient_id', recipientId)
        .is('read_at', null)
      if (error) throw error
    },

    async createMessage({ id, senderId, recipientId, body }) {
      const { data, error } = await client.from('messages')
        .insert({ id, sender_id: senderId, recipient_id: recipientId, body })
        .select('id, sender_id, recipient_id, body, created_at')
        .single()
      if (error) throw error
      return mapMessage(data)
    },
  }
}

export class SupabaseSessionStore extends session.Store {
  constructor(client) {
    super()
    this.client = client
    this.cleanupTimer = setInterval(() => {
      this.client.from('sessions')
        .delete()
        .lte('expire', Date.now())
        .then(({ error }) => {
          if (error) console.error('Failed to remove expired Supabase sessions:', error)
        })
        .catch((error) => console.error('Failed to remove expired Supabase sessions:', error))
    }, 60 * 60 * 1000)
    this.cleanupTimer.unref()
  }

  get(sid, callback) {
    this.client.from('sessions')
      .select('sess, expire')
      .eq('sid', sid)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error) throw error
        if (!data || data.expire <= Date.now()) {
          if (data) {
            const { error: deleteError } = await this.client.from('sessions').delete().eq('sid', sid)
            if (deleteError) throw deleteError
          }
          callback(null, null)
          return
        }
        callback(null, data.sess)
      })
      .catch(callback)
  }

  set(sid, value, callback = () => {}) {
    const expire = value.cookie?.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + 86400000
    this.client.from('sessions')
      .upsert({ sid, sess: value, expire })
      .then(({ error }) => callback(error || undefined))
      .catch(callback)
  }

  destroy(sid, callback = () => {}) {
    this.client.from('sessions')
      .delete()
      .eq('sid', sid)
      .then(({ error }) => callback(error || undefined))
      .catch(callback)
  }

  touch(sid, value, callback = () => {}) {
    const expire = value.cookie?.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + 86400000
    this.client.from('sessions')
      .update({ expire })
      .eq('sid', sid)
      .then(({ error }) => callback(error || undefined))
      .catch(callback)
  }

  close() {
    clearInterval(this.cleanupTimer)
  }
}
