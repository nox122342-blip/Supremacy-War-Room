import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import express from 'express'
import session from 'express-session'

const root = dirname(fileURLToPath(import.meta.url))
const databasePath = resolve(process.env.DATABASE_PATH || resolve(root, 'data', 'supremacy.sqlite'))
mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    faction TEXT NOT NULL,
    theatre TEXT NOT NULL DEFAULT 'global',
    category TEXT NOT NULL CHECK (category IN ('Economy', 'Warfare', 'Diplomacy', 'Logistics')),
    phase TEXT NOT NULL CHECK (phase IN ('Early', 'Mid', 'Late')),
    summary TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 88,
    shares INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS priorities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id),
    recipient_id TEXT NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_strategies_created ON strategies(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_priorities_user ON priorities(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_strategy ON comments(strategy_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, recipient_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`)

const strategyColumns = db.prepare('PRAGMA table_info(strategies)').all()
if (!strategyColumns.some((column) => column.name === 'theatre')) {
  db.exec("ALTER TABLE strategies ADD COLUMN theatre TEXT NOT NULL DEFAULT 'global'")
}

const userColumns = db.prepare('PRAGMA table_info(users)').all()
if (!userColumns.some((column) => column.name === 'is_demo')) {
  db.exec('ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0')
}
db.prepare(`
  UPDATE users SET is_demo = 1
  WHERE username IN ('GeneralVoss', 'KiteComms', 'MiraK', 'AstraFox')
`).run()
db.prepare('DELETE FROM strategies WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)').run()

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super()
    this.getStatement = database.prepare('SELECT sess, expire FROM sessions WHERE sid = ?')
    this.setStatement = database.prepare(`
      INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
    `)
    this.destroyStatement = database.prepare('DELETE FROM sessions WHERE sid = ?')
    this.touchStatement = database.prepare('UPDATE sessions SET expire = ? WHERE sid = ?')
    this.cleanupStatement = database.prepare('DELETE FROM sessions WHERE expire <= ?')
    this.cleanupTimer = setInterval(() => this.cleanupStatement.run(Date.now()), 60 * 60 * 1000)
    this.cleanupTimer.unref()
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid)
      if (!row || row.expire <= Date.now()) {
        this.destroyStatement.run(sid)
        callback(null, null)
        return
      }
      callback(null, JSON.parse(row.sess))
    } catch (error) {
      callback(error)
    }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000
      this.setStatement.run(sid, JSON.stringify(value), expires)
      callback()
    } catch (error) {
      callback(error)
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.destroyStatement.run(sid)
      callback()
    } catch (error) {
      callback(error)
    }
  }

  touch(sid, value, callback = () => {}) {
    try {
      const expires = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000
      this.touchStatement.run(expires, sid)
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

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
  store: new SQLiteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}))

const categories = new Set(['Economy', 'Warfare', 'Diplomacy', 'Logistics'])
const phases = new Set(['Early', 'Mid', 'Late'])
const theatres = new Set(['north-america', 'south-america', 'europe', 'middle-east', 'africa', 'asia-pacific', 'global'])
const getUser = db.prepare('SELECT id, username, created_at AS createdAt FROM users WHERE id = ? AND is_demo = 0')
const getStrategy = db.prepare(`
  SELECT s.id, s.user_id AS userId, s.title, s.faction, s.theatre, s.category, s.phase, s.summary,
         s.steps_json AS stepsJson, s.tags_json AS tagsJson, s.rating, s.shares,
         s.created_at AS createdAt, u.username AS author,
         (SELECT COUNT(*) FROM comments c WHERE c.strategy_id = s.id) AS commentCount
  FROM strategies s JOIN users u ON u.id = s.user_id WHERE s.id = ?
`)

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt }
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Sign in to continue.' })
    return
  }
  next()
}

function cleanText(value, maximum, field, minimum = 1) {
  if (typeof value !== 'string') return `${field} must be text.`
  const cleaned = value.trim()
  if (cleaned.length < minimum || cleaned.length > maximum) return `${field} must be ${minimum}-${maximum} characters.`
  return null
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
    steps: JSON.parse(row.stepsJson),
    tags: JSON.parse(row.tagsJson),
    rating: row.rating,
    shares: row.shares,
    commentCount: row.commentCount,
    createdAt: row.createdAt,
  }
}

const authAttempts = new Map()
function allowAuthAttempt(req, res, next) {
  const now = Date.now()
  const key = req.ip
  const attempt = authAttempts.get(key)
  if (attempt && attempt.until > now && attempt.count >= 10) {
    res.status(429).json({ error: 'Too many sign-in attempts. Please try again in 15 minutes.' })
    return
  }
  if (!attempt || attempt.until <= now) authAttempts.set(key, { count: 1, until: now + 15 * 60 * 1000 })
  else attempt.count += 1
  next()
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

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
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
      res.status(409).json({ error: 'That username is already taken.' })
      return
    }
    const userId = randomUUID()
    const passwordHash = await bcrypt.hash(req.body.password, 12)
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(userId, username, passwordHash)
    req.session.regenerate((error) => {
      if (error) return next(error)
      authAttempts.delete(req.ip)
      req.session.userId = userId
      req.session.save((saveError) => {
        if (saveError) return next(saveError)
        res.status(201).json({ user: publicUser(getUser.get(userId)) })
      })
    })
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
    const user = db.prepare('SELECT id, username, created_at AS createdAt, password_hash AS passwordHash FROM users WHERE username = ? COLLATE NOCASE').get(req.body.username.trim())
    const validPassword = user && await bcrypt.compare(req.body.password, user.passwordHash)
    if (!validPassword) {
      res.status(401).json({ error: 'Username or password is incorrect.' })
      return
    }
    req.session.regenerate((error) => {
      if (error) return next(error)
      authAttempts.delete(req.ip)
      req.session.userId = user.id
      req.session.save((saveError) => {
        if (saveError) return next(saveError)
        res.json({ user: publicUser(user) })
      })
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) {
    res.json({ user: null })
    return
  }
  const user = getUser.get(req.session.userId)
  if (!user) {
    req.session.destroy(() => {})
    res.json({ user: null })
    return
  }
  res.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error)
    res.clearCookie('supremacy.sid', {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    res.status(204).end()
  })
})

app.get('/api/strategies', (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 24, 1), 50)
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0)
  const query = typeof req.query.query === 'string' ? req.query.query.trim().slice(0, 100) : ''
  const category = typeof req.query.category === 'string' && categories.has(req.query.category)
    ? req.query.category
    : ''
  const conditions = []
  const parameters = []
  if (category) {
    conditions.push('s.category = ?')
    parameters.push(category)
  }
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`
    conditions.push(`(
      s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\' OR
      s.faction LIKE ? ESCAPE '\\' OR s.tags_json LIKE ? ESCAPE '\\' OR
      u.username LIKE ? ESCAPE '\\'
    )`)
    parameters.push(pattern, pattern, pattern, pattern, pattern)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const total = db.prepare(`
    SELECT COUNT(*) AS total FROM strategies s JOIN users u ON u.id = s.user_id ${where}
  `).get(...parameters).total
  const rows = db.prepare(`
    SELECT s.id, s.user_id AS userId, s.title, s.faction, s.theatre, s.category, s.phase, s.summary,
           s.steps_json AS stepsJson, s.tags_json AS tagsJson, s.rating, s.shares,
           s.created_at AS createdAt, u.username AS author,
           (SELECT COUNT(*) FROM comments c WHERE c.strategy_id = s.id) AS commentCount
    FROM strategies s JOIN users u ON u.id = s.user_id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, limit, offset)
  res.json({
    strategies: rows.map(serializeStrategy),
    total,
    hasMore: offset + rows.length < total,
  })
})

app.post('/api/strategies', requireAuth, (req, res) => {
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
  const id = randomUUID()
  db.prepare(`
    INSERT INTO strategies (id, user_id, title, faction, theatre, category, phase, summary, steps_json, tags_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.session.userId, title.trim(), faction.trim(), theatre, category, phase, summary.trim(),
    JSON.stringify(steps.map((step) => step.trim())), JSON.stringify(tags.map((tag) => tag.trim().toLowerCase())))
  res.status(201).json({ strategy: serializeStrategy(getStrategy.get(id)) })
})

app.get('/api/priorities', requireAuth, (req, res) => {
  const priorities = db.prepare(`
    SELECT id, body, created_at AS createdAt FROM priorities
    WHERE user_id = ? ORDER BY created_at ASC, rowid ASC
  `).all(req.session.userId)
  res.json({ priorities })
})

app.post('/api/priorities', requireAuth, (req, res) => {
  const validationError = cleanText(req.body.body, 180, 'Target')
  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }
  const count = db.prepare('SELECT COUNT(*) AS total FROM priorities WHERE user_id = ?').get(req.session.userId).total
  if (count >= 10) {
    res.status(409).json({ error: 'You can keep up to 10 high priority targets at a time.' })
    return
  }
  const id = randomUUID()
  db.prepare('INSERT INTO priorities (id, user_id, body) VALUES (?, ?, ?)').run(
    id, req.session.userId, req.body.body.trim(),
  )
  const priority = db.prepare(`
    SELECT id, body, created_at AS createdAt FROM priorities WHERE id = ?
  `).get(id)
  res.status(201).json({ priority })
})

app.delete('/api/priorities/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM priorities WHERE id = ? AND user_id = ?').run(
    req.params.id, req.session.userId,
  )
  if (result.changes === 0) {
    res.status(404).json({ error: 'High priority target not found.' })
    return
  }
  res.status(204).end()
})

app.get('/api/strategies/:id/comments', (req, res) => {
  if (!getStrategy.get(req.params.id)) {
    res.status(404).json({ error: 'Strategy not found.' })
    return
  }
  const comments = db.prepare(`
    SELECT c.id, c.body, c.created_at AS createdAt, u.id AS userId, u.username AS author
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.strategy_id = ? ORDER BY c.created_at ASC, c.rowid ASC
  `).all(req.params.id)
  res.json({ comments })
})

app.post('/api/strategies/:id/comments', requireAuth, (req, res) => {
  if (!getStrategy.get(req.params.id)) {
    res.status(404).json({ error: 'Strategy not found.' })
    return
  }
  const validationError = cleanText(req.body.body, 1000, 'Comment')
  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }
  const id = randomUUID()
  db.prepare('INSERT INTO comments (id, strategy_id, user_id, body) VALUES (?, ?, ?, ?)').run(
    id, req.params.id, req.session.userId, req.body.body.trim(),
  )
  const comment = db.prepare(`
    SELECT c.id, c.body, c.created_at AS createdAt, u.id AS userId, u.username AS author
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?
  `).get(id)
  res.status(201).json({ comment })
})

app.get('/api/users', requireAuth, (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : ''
  if (query.length < 2 || query.length > 24) {
    res.json({ users: [] })
    return
  }
  const users = db.prepare(`
    SELECT id, username FROM users
    WHERE id != ? AND is_demo = 0 AND username LIKE ? ESCAPE '\\'
    ORDER BY username LIMIT 10
  `).all(req.session.userId, `%${query.replace(/[\\%_]/g, '\\$&')}%`)
  res.json({ users })
})

app.get('/api/messages', requireAuth, (req, res) => {
  const userId = req.session.userId
  const conversations = db.prepare(`
    WITH latest AS (
      SELECT CASE WHEN sender_id = @userId THEN recipient_id ELSE sender_id END AS other_id,
             MAX(rowid) AS latest_row
      FROM messages
      WHERE sender_id = @userId OR recipient_id = @userId
      GROUP BY other_id
    )
    SELECT u.id AS userId, u.username,
           m.body AS lastMessage, m.created_at AS lastMessageAt,
           (SELECT COUNT(*) FROM messages unread
             WHERE unread.sender_id = u.id AND unread.recipient_id = @userId AND unread.read_at IS NULL) AS unread
    FROM latest l
    JOIN messages m ON m.rowid = l.latest_row
    JOIN users u ON u.id = l.other_id
    ORDER BY m.rowid DESC
  `).all({ userId })
  res.json({ conversations })
})

app.get('/api/messages/:userId', requireAuth, (req, res) => {
  const currentUserId = req.session.userId
  const otherUser = getUser.get(req.params.userId)
  if (!otherUser || otherUser.id === currentUserId) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  const messages = db.prepare(`
    SELECT id, sender_id AS senderId, recipient_id AS recipientId, body, created_at AS createdAt
    FROM messages
    WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
    ORDER BY rowid ASC LIMIT 200
  `).all(currentUserId, otherUser.id, otherUser.id, currentUserId)
  db.prepare(`
    UPDATE messages SET read_at = CURRENT_TIMESTAMP
    WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
  `).run(otherUser.id, currentUserId)
  res.json({ user: publicUser(otherUser), messages })
})

app.post('/api/messages/:userId', requireAuth, (req, res) => {
  const recipient = getUser.get(req.params.userId)
  if (!recipient || recipient.id === req.session.userId) {
    res.status(404).json({ error: 'User not found.' })
    return
  }
  const validationError = cleanText(req.body.body, 2000, 'Message')
  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }
  const id = randomUUID()
  db.prepare('INSERT INTO messages (id, sender_id, recipient_id, body) VALUES (?, ?, ?, ?)').run(
    id, req.session.userId, recipient.id, req.body.body.trim(),
  )
  const message = db.prepare(`
    SELECT id, sender_id AS senderId, recipient_id AS recipientId, body, created_at AS createdAt
    FROM messages WHERE id = ?
  `).get(id)
  res.status(201).json({ message })
})

app.use((error, _req, res, _next) => {
  console.error(error)
  if (res.headersSent) return
  res.status(500).json({ error: 'The server could not complete that request.' })
})

const port = Number(process.env.API_PORT || 3001)
const server = app.listen(port, () => {
  console.log(`Supremacy API listening on http://localhost:${port}`)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
