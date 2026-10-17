import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import express from 'express'
import session from 'express-session'
import { getSupabaseClient } from './supabase.mjs'
import { createSupabaseStore, SupabaseSessionStore } from './supabase-store.mjs'

const categories = new Set(['Economy', 'Warfare', 'Diplomacy', 'Logistics'])
const phases = new Set(['Early', 'Mid', 'Late'])
const theatres = new Set(['north-america', 'south-america', 'europe', 'middle-east', 'africa', 'asia-pacific', 'global'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cleanText(value, maximum, field, minimum = 1) {
  if (typeof value !== 'string') return `${field} must be text.`
  const cleaned = value.trim()
  if (cleaned.length < minimum || cleaned.length > maximum) return `${field} must be ${minimum}-${maximum} characters.`
  return null
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt }
}

function serializeStrategy(row) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    author: row.author,
    faction: row.faction,
    theatre: row.theatre,
    category: row.category,
    phase: row.phase,
    summary: row.summary,
    steps: Array.isArray(row.stepsJson) ? row.stepsJson : JSON.parse(row.stepsJson),
    tags: Array.isArray(row.tagsJson) ? row.tagsJson : JSON.parse(row.tagsJson),
    rating: row.rating,
    shares: row.shares,
    commentCount: row.commentCount,
    createdAt: row.createdAt,
  }
}

function allowAuthAttempt(req, res, next) {
  const now = Date.now()
  const attempt = authAttempts.get(req.ip)
  if (attempt && attempt.until > now && attempt.count >= 10) {
    res.status(429).json({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' })
    return
  }
  if (!attempt || attempt.until <= now) authAttempts.set(req.ip, { count: 1, until: now + 15 * 60 * 1000 })
  else attempt.count += 1
  next()
}

const authAttempts = new Map()
const authAttemptCleanup = setInterval(() => {
  const now = Date.now()
  for (const [ip, attempt] of authAttempts) {
    if (attempt.until <= now) authAttempts.delete(ip)
  }
}, 15 * 60 * 1000)
authAttemptCleanup.unref()

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Sign in to continue.' })
    return
  }
  next()
}

function regenerateSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error)
        return
      }
      req.session.userId = userId
      req.session.save((saveError) => saveError ? reject(saveError) : resolve())
    })
  })
}

function sendUnexpectedError(error, _req, res, _next) {
  console.error(error)
  if (res.headersSent) return
  res.status(500).json({ error: 'The server could not complete that request.' })
}

export function createApi({ client = getSupabaseClient() } = {}) {
  const store = createSupabaseStore(client)
  const sessionStore = new SupabaseSessionStore(client)
  const app = express()

  app.disable('x-powered-by')
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
  app.use(express.json({ limit: '16kb' }))

  const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://localhost',
    'capacitor://localhost',
    'supremacy://app',
    ...(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ])
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ error: 'This application origin is not allowed by the API.' })
      return
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.status(204).end()
      return
    }
    next()
  })
  app.use((req, res, next) => {
    if (req.is('application/json') && (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))) {
      res.status(400).json({ error: 'Request body must be a JSON object.' })
      return
    }
    if (!req.body) req.body = {}
    next()
  })

  const sessionSecret = process.env.SESSION_SECRET
  if (process.env.NODE_ENV === 'production' && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error('SESSION_SECRET must be set to a random value with at least 32 characters in production.')
  }
  app.use(session({
    name: 'supremacy.sid',
    secret: sessionSecret || 'local-development-only-secret-change-before-deployment',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }))

  app.get('/api/health', async (_req, res, next) => {
    try {
      const { error } = await client.from('users').select('id').limit(1)
      if (error) throw error
      res.json({ status: 'ok' })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/register', allowAuthAttempt, async (req, res, next) => {
    try {
      const usernameError = cleanText(req.body.username, 24, 'Username', 3)
      const passwordError = cleanText(req.body.password, 128, 'Password', 10)
      if (usernameError || passwordError) {
        res.status(400).json({ error: usernameError || passwordError })
        return
      }
      const username = req.body.username.trim()
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens.' })
        return
      }
      if (await store.getUserByUsername(username)) {
        res.status(409).json({ error: 'That username is already taken.' })
        return
      }

      const userId = randomUUID()
      const passwordHash = await bcrypt.hash(req.body.password, 12)
      let user
      try {
        user = await store.createUser({ id: userId, username, passwordHash })
      } catch (error) {
        if (error.code === '23505') {
          res.status(409).json({ error: 'That username is already taken.' })
          return
        }
        throw error
      }
      await regenerateSession(req, userId)
      authAttempts.delete(req.ip)
      res.status(201).json({ user: publicUser(user) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/login', allowAuthAttempt, async (req, res, next) => {
    try {
      if (typeof req.body.username !== 'string' || typeof req.body.password !== 'string') {
        res.status(400).json({ error: 'Enter your username and password.' })
        return
      }
      const user = await store.getUserByUsername(req.body.username.trim())
      const validPassword = user && !user.isDemo && await bcrypt.compare(req.body.password, user.passwordHash)
      if (!validPassword) {
        res.status(401).json({ error: 'Username or password is incorrect.' })
        return
      }
      await regenerateSession(req, user.id)
      authAttempts.delete(req.ip)
      res.json({ user: publicUser(user) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/auth/me', async (req, res, next) => {
    try {
      if (!req.session.userId) {
        res.json({ user: null })
        return
      }
      const user = await store.getUser(req.session.userId)
      if (!user) {
        req.session.destroy((error) => {
          if (error) return next(error)
          res.json({ user: null })
        })
        return
      }
      res.json({ user: publicUser(user) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/auth/logout', requireAuth, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('supremacy.sid', {
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: process.env.NODE_ENV === 'production',
      })
      res.status(204).end()
    })
  })

  app.get('/api/strategies', async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 50)
      const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0)
      const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 100) : ''
      const category = typeof req.query.category === 'string' && categories.has(req.query.category)
        ? req.query.category
        : ''
      const result = await store.listStrategies({ query, category, limit, offset })
      res.json({ ...result, strategies: result.strategies.map(serializeStrategy) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/strategies', requireAuth, async (req, res, next) => {
    try {
      const { title, faction, theatre, category, phase, summary, steps, tags } = req.body
      const validationError =
        cleanText(title, 100, 'Title') ||
        cleanText(faction, 60, 'Faction') ||
        cleanText(summary, 1500, 'Summary')
      if (validationError) {
        res.status(400).json({ error: validationError })
        return
      }
      if (!theatres.has(theatre) || !categories.has(category) || !phases.has(phase)) {
        res.status(400).json({ error: 'Choose a valid theatre, category, and phase.' })
        return
      }
      if (!Array.isArray(steps) || steps.length > 8 || steps.some((step) => typeof step !== 'string' || !step.trim() || step.length > 300)) {
        res.status(400).json({ error: 'Game plan must contain up to 8 steps, each no longer than 300 characters.' })
        return
      }
      if (!Array.isArray(tags) || tags.length > 8 || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 32)) {
        res.status(400).json({ error: 'Tags must contain up to 8 entries, each no longer than 32 characters.' })
        return
      }
      const strategy = await store.createStrategy({
        id: randomUUID(),
        userId: req.session.userId,
        title: title.trim(),
        faction: faction.trim(),
        theatre,
        category,
        phase,
        summary: summary.trim(),
        steps: steps.map((step) => step.trim()),
        tags: tags.map((tag) => tag.trim().toLowerCase()),
      })
      res.status(201).json({ strategy: serializeStrategy(strategy) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/priorities', requireAuth, async (req, res, next) => {
    try {
      res.json({ priorities: await store.listPriorities(req.session.userId) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/priorities', requireAuth, async (req, res, next) => {
    try {
      const validationError = cleanText(req.body.body, 180, 'Target')
      if (validationError) {
        res.status(400).json({ error: validationError })
        return
      }
      if (await store.countPriorities(req.session.userId) >= 10) {
        res.status(409).json({ error: 'You can keep up to 10 high priority targets at a time.' })
        return
      }
      const priority = await store.createPriority({
        id: randomUUID(),
        userId: req.session.userId,
        body: req.body.body.trim(),
      })
      res.status(201).json({ priority })
    } catch (error) {
      if (error.code === 'P0001' && error.message === 'PRIORITY_LIMIT_REACHED') {
        res.status(409).json({ error: 'You can keep up to 10 high priority targets at a time.' })
        return
      }
      next(error)
    }
  })

  app.delete('/api/priorities/:id', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.id)) {
        res.status(404).json({ error: 'High priority target not found.' })
        return
      }
      if (!await store.deletePriority(req.params.id, req.session.userId)) {
        res.status(404).json({ error: 'High priority target not found.' })
        return
      }
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/strategies/:id/comments', async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.id)) {
        res.status(404).json({ error: 'Strategy not found.' })
        return
      }
      if (!await store.getStrategy(req.params.id)) {
        res.status(404).json({ error: 'Strategy not found.' })
        return
      }
      res.json({ comments: await store.listComments(req.params.id) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/strategies/:id/comments', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.id)) {
        res.status(404).json({ error: 'Strategy not found.' })
        return
      }
      if (!await store.getStrategy(req.params.id)) {
        res.status(404).json({ error: 'Strategy not found.' })
        return
      }
      const validationError = cleanText(req.body.body, 1000, 'Comment')
      if (validationError) {
        res.status(400).json({ error: validationError })
        return
      }
      const comment = await store.createComment({
        id: randomUUID(),
        strategyId: req.params.id,
        userId: req.session.userId,
        body: req.body.body.trim(),
      })
      res.status(201).json({ comment })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/strategies/:id', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.id) || !await store.deleteStrategy(req.params.id, req.session.userId)) {
        res.status(404).json({ error: 'Strategy not found.' })
        return
      }
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/comments/:id', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.id) || !await store.deleteComment(req.params.id, req.session.userId)) {
        res.status(404).json({ error: 'Comment not found.' })
        return
      }
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/users', requireAuth, async (req, res, next) => {
    try {
      const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
      if (query.length < 2 || query.length > 24) {
        res.json({ users: [] })
        return
      }
      res.json({ users: await store.searchUsers(req.session.userId, query) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/messages', requireAuth, async (req, res, next) => {
    try {
      res.json({ conversations: await store.listConversations(req.session.userId) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/messages/:userId', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.userId)) {
        res.status(404).json({ error: 'User not found.' })
        return
      }
      const currentUserId = req.session.userId
      const otherUser = await store.getUser(req.params.userId)
      if (!otherUser || otherUser.id === currentUserId) {
        res.status(404).json({ error: 'User not found.' })
        return
      }
      const messages = await store.listMessages(currentUserId, otherUser.id)
      await store.markMessagesRead(otherUser.id, currentUserId)
      res.json({ user: publicUser(otherUser), messages })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/messages/:userId', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.userId)) {
        res.status(404).json({ error: 'User not found.' })
        return
      }
      const recipient = await store.getUser(req.params.userId)
      if (!recipient || recipient.id === req.session.userId) {
        res.status(404).json({ error: 'User not found.' })
        return
      }
      const validationError = cleanText(req.body.body, 2000, 'Message')
      if (validationError) {
        res.status(400).json({ error: validationError })
        return
      }
      const message = await store.createMessage({
        id: randomUUID(),
        senderId: req.session.userId,
        recipientId: recipient.id,
        body: req.body.body.trim(),
      })
      res.status(201).json({ message })
    } catch (error) {
      next(error)
    }
  })

  const allianceErrors = {
    already_member: [409, 'Leave your current alliance first.'],
    name_taken: [409, 'That alliance name is already taken.'],
    not_found: [404, 'Alliance not found.'],
    full: [409, 'This alliance is full (128 members maximum).'],
    not_member: [404, 'You are not in an alliance.'],
  }

  async function currentAllianceResponse(userId) {
    const alliance = await store.getUserAlliance(userId)
    return { alliance, members: alliance ? await store.listAllianceMembers(alliance.id) : [] }
  }

  app.get('/api/alliances', requireAuth, async (req, res, next) => {
    try {
      const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 32) : ''
      res.json({ alliances: await store.listAlliances(query) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/alliances/me', requireAuth, async (req, res, next) => {
    try {
      res.json(await currentAllianceResponse(req.session.userId))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/alliances', requireAuth, async (req, res, next) => {
    try {
      const validationError = cleanText(req.body.name, 32, 'Alliance name', 3)
      if (validationError) {
        res.status(400).json({ error: validationError })
        return
      }
      const name = req.body.name.trim()
      if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
        res.status(400).json({ error: 'Alliance name can only contain letters, numbers, spaces, underscores, and hyphens.' })
        return
      }
      const status = await store.createAlliance({ id: randomUUID(), userId: req.session.userId, name })
      if (status !== 'ok') {
        const [code, error] = allianceErrors[status] || [500, 'The server could not complete that request.']
        res.status(code).json({ error })
        return
      }
      res.status(201).json(await currentAllianceResponse(req.session.userId))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/alliances/leave', requireAuth, async (req, res, next) => {
    try {
      const status = await store.leaveAlliance(req.session.userId)
      if (status !== 'ok') {
        const [code, error] = allianceErrors[status] || [500, 'The server could not complete that request.']
        res.status(code).json({ error })
        return
      }
      res.json({ alliance: null, members: [] })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/alliances/:id/join', requireAuth, async (req, res, next) => {
    try {
      if (!UUID_PATTERN.test(req.params.id)) {
        res.status(404).json({ error: 'Alliance not found.' })
        return
      }
      const status = await store.joinAlliance(req.params.id, req.session.userId)
      if (status !== 'ok') {
        const [code, error] = allianceErrors[status] || [500, 'The server could not complete that request.']
        res.status(code).json({ error })
        return
      }
      res.json(await currentAllianceResponse(req.session.userId))
    } catch (error) {
      next(error)
    }
  })

  app.use(sendUnexpectedError)

  return {
    app,
    close() {
      sessionStore.close()
      clearInterval(authAttemptCleanup)
    },
  }
}

export function startServer(port = Number(process.env.API_PORT || 3001)) {
  const api = createApi()
  const server = api.app.listen(port, () => {
    console.log(`Supremacy API listening on http://localhost:${port}`)
  })

  function shutdown() {
    server.close(() => {
      api.close()
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
