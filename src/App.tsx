import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type StrategyCategory = 'Economy' | 'Warfare' | 'Diplomacy' | 'Logistics'
type StrategyPhase = 'Early' | 'Mid' | 'Late'
type Theatre = 'north-america' | 'south-america' | 'europe' | 'middle-east' | 'africa' | 'asia-pacific' | 'global'
type Tab = 'All' | 'Map' | StrategyCategory

type MapRegion = {
  id: Theatre
  name: string
  x: number
  y: number
  description: string
}

type User = {
  id: string
  username: string
  createdAt?: string
}

type Strategy = {
  id: string
  userId: string
  title: string
  author: string
  faction: string
  theatre: Theatre
  category: StrategyCategory
  phase: StrategyPhase
  summary: string
  steps: string[]
  tags: string[]
  rating: number
  shares: number
  commentCount: number
  createdAt: string
  isLocal?: boolean
}

type Comment = {
  id: string
  body: string
  author: string
  userId: string
  createdAt: string
}

type Message = {
  id: string
  senderId: string
  recipientId: string
  body: string
  createdAt: string
}

type Alliance = {
  id: string
  name: string
  ownerId: string
  createdAt: string
  memberCount: number
  maxMembers: number
}

type AllianceMember = { userId: string; username: string; joinedAt: string }
type AllianceState = { alliance: Alliance | null; members: AllianceMember[] }

type Conversation = {
  userId: string
  username: string
  lastMessage: string
  lastMessageAt: string
  unread: number
}

type Priority = {
  id: string
  body: string
  createdAt: string
}

const categories: StrategyCategory[] = ['Economy', 'Warfare', 'Diplomacy', 'Logistics']
const mapRegions: MapRegion[] = [
  { id: 'north-america', name: 'North America', x: 196, y: 182, description: 'Industrial hubs, supply depots, and sea-lane escorts.' },
  { id: 'south-america', name: 'South America', x: 300, y: 323, description: 'Resource lines and coastal pressure points.' },
  { id: 'europe', name: 'Europe', x: 524, y: 146, description: 'Dense alliances, central logistics, and front-line pressure.' },
  { id: 'middle-east', name: 'Middle East', x: 640, y: 228, description: 'Fuel corridors and air superiority routes.' },
  { id: 'africa', name: 'Africa', x: 556, y: 300, description: 'Shipping lanes, staging zones, and strategic desert routes.' },
  { id: 'asia-pacific', name: 'Asia-Pacific', x: 810, y: 200, description: 'Naval reach, manufacturing, and rapid reinforcement windows.' },
  { id: 'global', name: 'Global / Other', x: 500, y: 240, description: 'Strategies that span multiple theatres or do not fit one region.' },
]
const tabs: Tab[] = ['All', 'Map', ...categories]
const accentPresets = [
  { label: 'Orange', color: '#f97316' },
  { label: 'Red', color: '#ef4444' },
  { label: 'Pink', color: '#ec4899' },
  { label: 'Purple', color: '#a855f7' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Cyan', color: '#06b6d4' },
  { label: 'Teal', color: '#14b8a6' },
  { label: 'Green', color: '#22c55e' },
]

const emptyForm = {
  title: '',
  faction: '',
  theatre: '' as '' | Theatre,
  category: 'Economy' as StrategyCategory,
  phase: 'Early' as StrategyPhase,
  summary: '',
  tags: '',
  steps: '',
}

const strategiesPerPage = 16
const defaultAccent = '#f97316'

type AccentStyle = CSSProperties & {
  '--accent-color': string
  '--accent-foreground': string
}

function SpinningGlobeMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' })
    if (!gl) {
      console.error('WebGL is unavailable; showing a static globe map.')
      return
    }

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) {
        console.error('Could not create a shader for the globe map.')
        return null
      }
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Could not compile the globe map shader.', gl.getShaderInfoLog(shader))
        gl.deleteShader(shader)
        return null
      }
      return shader
    }

    const vertexShader = compileShader(gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      varying vec2 v_position;
      void main() {
        v_position = a_position;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `)
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 v_position;
      uniform sampler2D u_map;
      uniform float u_rotation;
      void main() {
        vec2 point = v_position;
        float radiusSquared = dot(point, point);
        if (radiusSquared > 1.0) discard;
        float depth = sqrt(1.0 - radiusSquared);
        vec3 normal = normalize(vec3(point.x, point.y, depth));
        float longitude = atan(normal.x, normal.z);
        float latitude = asin(clamp(normal.y, -1.0, 1.0));
        vec2 mapUv = vec2(fract(0.5 + longitude / 6.28318530718 + u_rotation), 0.5 + latitude / 3.14159265359);
        vec4 land = texture2D(u_map, mapUv);
        vec3 lightDirection = normalize(vec3(-0.48, 0.56, 0.68));
        float diffuse = max(dot(normal, lightDirection), 0.0);
        float rim = pow(1.0 - depth, 2.2);
        float lighting = 0.28 + diffuse * 0.72;
        vec3 landColor = mix(vec3(0.04, 0.34, 0.48), vec3(0.58, 1.0, 0.93), lighting);
        landColor += vec3(0.10, 0.48, 0.58) * rim;
        gl_FragColor = vec4(landColor, land.a * lighting * 0.92);
      }
    `)

    if (!vertexShader || !fragmentShader) return
    const program = gl.createProgram()
    if (!program) {
      console.error('Could not create the globe map shader program.')
      return
    }
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Could not link the globe map shader program.', gl.getProgramInfoLog(program))
      gl.deleteProgram(program)
      return
    }

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const rotationLocation = gl.getUniformLocation(program, 'u_rotation')
    const mapLocation = gl.getUniformLocation(program, 'u_map')
    const vertexBuffer = gl.createBuffer()
    const texture = gl.createTexture()
    if (!vertexBuffer || !texture) {
      console.error('Could not allocate graphics resources for the globe map.')
      gl.deleteProgram(program)
      return
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.useProgram(program)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.uniform1i(mapLocation, 0)

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const image = new Image()
    let animationFrame: number | undefined
    let startTime: number | undefined
    let disposed = false

    const drawFrame = (time: number) => {
      if (disposed) return
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * pixelRatio))
      const height = Math.max(1, Math.round(bounds.height * pixelRatio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (startTime !== undefined) {
        const rotation = motionPreference.matches ? 0 : ((time - startTime) / 24000) % 1
        gl.uniform1f(rotationLocation, rotation)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        canvas.parentElement?.classList.add('webgl-ready')
      }
    }

    const animate = (time: number) => {
      drawFrame(time)
      if (!motionPreference.matches && !document.hidden) {
        animationFrame = window.requestAnimationFrame(animate)
      }
    }

    const updateAnimation = () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
      animationFrame = undefined
      drawFrame(performance.now())
      if (!motionPreference.matches && !document.hidden && startTime !== undefined) {
        animationFrame = window.requestAnimationFrame(animate)
      }
    }

    const resizeObserver = new ResizeObserver(updateAnimation)
    resizeObserver.observe(canvas)
    motionPreference.addEventListener('change', updateAnimation)
    document.addEventListener('visibilitychange', updateAnimation)
    image.onload = () => {
      if (disposed) return
      const textureCanvas = document.createElement('canvas')
      textureCanvas.width = 512
      textureCanvas.height = 256
      const textureContext = textureCanvas.getContext('2d')
      if (!textureContext) {
        console.error('Could not prepare the globe map texture.')
        return
      }
      textureContext.drawImage(image, 0, 0, textureCanvas.width, textureCanvas.height)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureCanvas)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      textureCanvas.width = 0
      textureCanvas.height = 0
      startTime = performance.now()
      updateAnimation()
    }
    image.onerror = () => console.error('Could not load the globe map texture.')
    image.src = `${import.meta.env.BASE_URL}globe-map.svg`

    return () => {
      disposed = true
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      motionPreference.removeEventListener('change', updateAnimation)
      document.removeEventListener('visibilitychange', updateAnimation)
      image.onload = null
      image.onerror = null
      gl.deleteTexture(texture)
      gl.deleteBuffer(vertexBuffer)
      gl.deleteProgram(program)
    }
  }, [])

  return <canvas ref={canvasRef} className="globe-map" aria-hidden="true" />
}

function getStoredAccent() {
  const stored = localStorage.getItem('supremacy.accentColor')
  return stored && /^#[\da-f]{6}$/i.test(stored) ? stored : defaultAccent
}

function getAccentForeground(color: string) {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  return luminance > 0.58 ? '#111827' : '#ffffff'
}

function readLocalList<T>(key: string): T[] {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) throw new Error('Stored offline data is not a list.')
    return parsed as T[]
  } catch (error) {
    console.error(`Could not load ${key} from local storage.`, error)
    return []
  }
}

const defaultApiBaseUrl = (
  import.meta.env.VITE_API_URL?.trim() ||
  (import.meta.env.PROD ? 'https://ckgkfvylkaiyladbxqfp.supabase.co/functions/v1' : '')
).replace(/\/+$/, '').replace(/\/api$/, '')

function getApiUrl() {
  const configuredUrl = localStorage.getItem('supremacy.apiUrl')?.trim()
  const baseUrl = configuredUrl || defaultApiBaseUrl
  return baseUrl ? `${baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api` : '/api'
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const accessToken = localStorage.getItem('supremacy.accessToken')
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(result?.error || `Request failed (${response.status}).`)
  }
  if (path === '/auth/logout') localStorage.removeItem('supremacy.accessToken')
  if (response.status === 204) return undefined as T
  const result = (await response.json()) as T & { accessToken?: string }
  if (result.accessToken) localStorage.setItem('supremacy.accessToken', result.accessToken)
  return result
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

function getStrategyRegion(strategy: Strategy) {
  return mapRegions.some((region) => region.id === strategy.theatre) ? strategy.theatre : 'global'
}

function isTheatre(value: string): value is Theatre {
  return mapRegions.some((region) => region.id === value)
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('All')
  const [selectedMapRegion, setSelectedMapRegion] = useState('All')
  const [selectedMapStrategyId, setSelectedMapStrategyId] = useState<string | null>(null)
  const [highPriorityOpen, setHighPriorityOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [feedOffset, setFeedOffset] = useState(0)
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedLoaded, setFeedLoaded] = useState(false)
  const [feedLoading, setFeedLoading] = useState(false)
  const [priorities, setPriorities] = useState<Priority[]>([])
  const [priorityDraft, setPriorityDraft] = useState('')
  const [editingPriorityId, setEditingPriorityId] = useState<string | null>(null)
  const [prioritiesLoading, setPrioritiesLoading] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [offlineMode, setOfflineMode] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [editingStrategyId, setEditingStrategyId] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authForm, setAuthForm] = useState({ username: '', password: '' })
  const [formData, setFormData] = useState(emptyForm)
  const [error, setError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState<string[]>([])
  const [commentsByStrategy, setCommentsByStrategy] = useState<Record<string, Comment[]>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [alliancesOpen, setAlliancesOpen] = useState(false)
  const [myAlliance, setMyAlliance] = useState<Alliance | null>(null)
  const [allianceMembers, setAllianceMembers] = useState<AllianceMember[]>([])
  const [allianceResults, setAllianceResults] = useState<Alliance[]>([])
  const [allianceQuery, setAllianceQuery] = useState('')
  const [allianceName, setAllianceName] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversation, setActiveConversation] = useState<User | null>(null)
  const [conversationMessages, setConversationMessages] = useState<Message[]>([])
  const [messageDraft, setMessageDraft] = useState('')
  const [userQuery, setUserQuery] = useState('')
  const [userResults, setUserResults] = useState<User[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [serverDraft, setServerDraft] = useState(() => localStorage.getItem('supremacy.apiUrl') || defaultApiBaseUrl)
  const [configuredServer, setConfiguredServer] = useState(() => localStorage.getItem('supremacy.apiUrl') || '')
  const feedRequestVersion = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<HTMLDivElement>(null)
  const globeAnchorRef = useRef<HTMLSpanElement>(null)
  const [hologramBounds, setHologramBounds] = useState<CSSProperties>({ visibility: 'hidden' })
  const [accentColor, setAccentColor] = useState(getStoredAccent)
  const accentStyle: AccentStyle = {
    '--accent-color': accentColor,
    '--accent-foreground': getAccentForeground(accentColor),
  }

  useEffect(() => {
    const updateHologramBounds = () => {
      const anchor = globeAnchorRef.current
      if (!anchor) return
      const bounds = anchor.getBoundingClientRect()
      const diameter = Math.min(bounds.width, bounds.height)
      setHologramBounds({
        left: `${bounds.left + (bounds.width - diameter) / 2}px`,
        top: `${bounds.top + (bounds.height - diameter) / 2}px`,
        width: `${diameter}px`,
        height: `${diameter}px`,
        visibility: 'visible',
      })
    }

    updateHologramBounds()
    const observer = new ResizeObserver(updateHologramBounds)
    if (logoRef.current) observer.observe(logoRef.current)
    window.addEventListener('resize', updateHologramBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateHologramBounds)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        setMenuOpen(false)
      } else if (event instanceof MouseEvent && event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeMenu)
    window.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [menuOpen])

  useEffect(() => {
    let cancelled = false
    api<{ user: User | null }>('/auth/me')
      .then(({ user: currentUser }) => {
        if (!cancelled) setUser(currentUser)
      })
      .catch(() => {
        if (!cancelled) {
          setOfflineMode(true)
          setUser(null)
          setStrategies(readLocalList<Strategy>('supremacy.offlineStrategies'))
          setPriorities(readLocalList<Priority>('supremacy.offlinePriorities'))
          setFeedLoaded(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (offlineMode) return
    const requestVersion = ++feedRequestVersion.current
    const controller = new AbortController()
    const parameters = new URLSearchParams({ limit: String(strategiesPerPage) })
    const category = activeTab !== 'All' ? activeTab : ''
    if (category) parameters.set('category', category)
    if (query.trim()) parameters.set('query', query.trim())
    api<{ strategies: Strategy[]; total: number; hasMore: boolean }>(
      `/strategies?${parameters.toString()}`,
      { signal: controller.signal },
    )
      .then(({ strategies: feed, hasMore }) => {
        if (requestVersion !== feedRequestVersion.current) return
        setStrategies([...readLocalList<Strategy>('supremacy.offlineStrategies'), ...feed])
        setFeedOffset(feed.length)
        setFeedHasMore(hasMore)
        setFeedLoaded(true)
        setLoading(false)
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted || requestVersion !== feedRequestVersion.current) return
        console.error('Could not load the strategy feed.', requestError)
        setOfflineMode(true)
        setStrategies(readLocalList<Strategy>('supremacy.offlineStrategies'))
        setFeedOffset(0)
        setFeedHasMore(false)
        setFeedLoaded(true)
        setLoading(false)
        setFeedLoading(false)
      })
      .finally(() => {
        if (!controller.signal.aborted && requestVersion === feedRequestVersion.current) setFeedLoading(false)
      })
    return () => {
      controller.abort()
      feedRequestVersion.current += 1
    }
  }, [activeTab, offlineMode, query])

  const loadMoreStrategies = async () => {
    if (feedLoading || !feedHasMore || offlineMode) return
    const requestVersion = feedRequestVersion.current
    const parameters = new URLSearchParams({
      limit: String(strategiesPerPage),
      offset: String(feedOffset),
    })
    const category = activeTab !== 'All' ? activeTab : ''
    if (category) parameters.set('category', category)
    if (query.trim()) parameters.set('query', query.trim())
    setFeedLoading(true)
    try {
      const { strategies: feed, hasMore } = await api<{
        strategies: Strategy[]
        total: number
        hasMore: boolean
      }>(`/strategies?${parameters.toString()}`)
      if (requestVersion !== feedRequestVersion.current) return
      setStrategies((current) => [...current, ...feed])
      setFeedOffset((current) => current + feed.length)
      setFeedHasMore(hasMore)
    } catch (requestError) {
      if (requestVersion !== feedRequestVersion.current) return
      setError(requestError instanceof Error ? requestError.message : 'Could not load more strategies.')
    } finally {
      if (requestVersion === feedRequestVersion.current) setFeedLoading(false)
    }
  }

  const persistOfflineStrategies = (nextStrategies: Strategy[]) => {
    try {
      localStorage.setItem(
        'supremacy.offlineStrategies',
        JSON.stringify(nextStrategies.filter((strategy) => strategy.isLocal)),
      )
    } catch (storageError) {
      console.error('Could not save offline strategies to local storage.', storageError)
      setError('Your offline strategies could not be saved on this device.')
    }
  }

  const persistOfflinePriorities = (nextPriorities: Priority[]) => {
    try {
      localStorage.setItem('supremacy.offlinePriorities', JSON.stringify(nextPriorities))
    } catch (storageError) {
      console.error('Could not save offline targets to local storage.', storageError)
      setError('Your offline targets could not be saved on this device.')
    }
  }

  useEffect(() => {
    if (!user || !messagesOpen) return
    api<{ conversations: Conversation[] }>('/messages')
      .then(({ conversations: nextConversations }) => setConversations(nextConversations))
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Could not load messages.'))
  }, [messagesOpen, user])

  useEffect(() => {
    if (!user || !alliancesOpen) return
    const timer = window.setTimeout(() => {
      Promise.all([
        api<AllianceState>('/alliances/me'),
        api<{ alliances: Alliance[] }>(`/alliances?query=${encodeURIComponent(allianceQuery.trim())}`),
      ])
        .then(([mine, list]) => {
          setMyAlliance(mine.alliance)
          setAllianceMembers(mine.members)
          setAllianceResults(list.alliances)
        })
        .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Could not load alliances.'))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [alliancesOpen, allianceQuery, user, myAlliance?.id])

  const applyAllianceState = (state: AllianceState) => {
    setMyAlliance(state.alliance)
    setAllianceMembers(state.members)
  }

  const runAllianceAction = async (path: string, body?: unknown) => {
    setError('')
    try {
      applyAllianceState(await api<AllianceState>(path, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      }))
      setAllianceName('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Alliance request failed.')
    }
  }

  useEffect(() => {
    if (!highPriorityOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHighPriorityOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [highPriorityOpen])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    api<{ priorities: Priority[] }>('/priorities')
      .then(({ priorities: nextPriorities }) => {
        if (!cancelled) setPriorities(nextPriorities)
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : 'Could not load high priority targets.')
      })
      .finally(() => {
        if (!cancelled) setPrioritiesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user || userQuery.trim().length < 2) {
      return
    }
    const timer = window.setTimeout(() => {
      api<{ users: User[] }>(`/users?query=${encodeURIComponent(userQuery.trim())}`)
        .then(({ users }) => setUserResults(users))
        .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Could not search users.'))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [user, userQuery])

  const filteredStrategies = useMemo(() => {
    return strategies.filter((strategy) => {
      const matchesTab = activeTab === 'All' || activeTab === 'Map' || strategy.category === activeTab
      const haystack =
        `${strategy.title} ${strategy.summary} ${strategy.author} ${strategy.faction} ${strategy.tags.join(' ')}`.toLowerCase()
      return matchesTab && haystack.includes(query.trim().toLowerCase())
    })
  }, [activeTab, query, strategies])

  const mapPanelStrategies = useMemo(() => {
    if (selectedMapRegion === 'All') return filteredStrategies
    return filteredStrategies.filter((strategy) => getStrategyRegion(strategy) === selectedMapRegion)
  }, [filteredStrategies, selectedMapRegion])

  const globalStats = useMemo(() => {
    const totalShared = strategies.reduce((sum, strategy) => sum + strategy.shares, 0)
    const averageRating = strategies.length
      ? Math.round(strategies.reduce((sum, strategy) => sum + strategy.rating, 0) / strategies.length)
      : 0
    return { totalShared, averageRating }
  }, [strategies])

  const toggleFavorite = (id: string) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((favoriteId) => favoriteId !== id) : [...current, id],
    )
  }

  const submitPriority = async (event: FormEvent) => {
    event.preventDefault()
    if (!priorityDraft.trim()) return
    setError('')
    if (offlineMode) {
      let nextPriorities: Priority[]
      if (editingPriorityId) {
        nextPriorities = priorities.map((priority) =>
          priority.id === editingPriorityId ? { ...priority, body: priorityDraft.trim() } : priority,
        )
      } else if (priorities.length < 10) {
        nextPriorities = [
          ...priorities,
          { id: crypto.randomUUID(), body: priorityDraft.trim(), createdAt: new Date().toISOString() },
        ]
      } else return
      persistOfflinePriorities(nextPriorities)
      setPriorities(nextPriorities)
      setPriorityDraft('')
      setEditingPriorityId(null)
      return
    }
    try {
      const { priority } = await api<{ priority: Priority }>('/priorities', {
        method: 'POST',
        body: JSON.stringify({ body: priorityDraft }),
      })
      setPriorities((current) => [...current, priority])
      setPriorityDraft('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save the high priority target.')
    }
  }

  const deletePriority = async (id: string) => {
    setError('')
    if (offlineMode) {
      const nextPriorities = priorities.filter((priority) => priority.id !== id)
      persistOfflinePriorities(nextPriorities)
      setPriorities(nextPriorities)
      if (editingPriorityId === id) {
        setEditingPriorityId(null)
        setPriorityDraft('')
      }
      return
    }
    try {
      await api(`/priorities/${id}`, { method: 'DELETE' })
      setPriorities((current) => current.filter((priority) => priority.id !== id))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not remove the high priority target.')
    }
  }

  const saveServerUrl = (event: FormEvent) => {
    event.preventDefault()
    const candidate = serverDraft.trim().replace(/\/+$/, '')
    if (candidate) {
      try {
        const url = new URL(candidate)
        const defaultUrl = defaultApiBaseUrl ? new URL(defaultApiBaseUrl) : null
        const isDefaultApiUrl = defaultUrl &&
          url.origin === defaultUrl.origin &&
          url.pathname.replace(/\/+$/, '') === defaultUrl.pathname.replace(/\/+$/, '')
        if ((url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') ||
          url.username || url.password || url.search || url.hash ||
          (url.pathname !== '/' && url.pathname !== '/api' && !isDefaultApiUrl)) {
          throw new Error('Use an HTTPS server URL, such as https://war-room.example.com.')
        }
      } catch (validationError) {
        setError(validationError instanceof Error ? validationError.message : 'Enter a valid server URL.')
        return
      }
    }
    const normalized = candidate.replace(/\/api$/, '')
    if (normalized) localStorage.setItem('supremacy.apiUrl', normalized)
    else localStorage.removeItem('supremacy.apiUrl')
    setConfiguredServer(normalized)
    setServerDraft(normalized)
    setMenuOpen(false)
    setError('')
    window.location.reload()
  }

  const updateAccentColor = (color: string) => {
    setAccentColor(color)
    try {
      localStorage.setItem('supremacy.accentColor', color)
    } catch (storageError) {
      console.error('Could not save the interface color preference.', storageError)
      setError('Your interface color could not be saved on this device.')
    }
  }

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setAuthBusy(true)
    try {
      const { user: signedInUser } = await api<{ user: User }>(`/auth/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(authForm),
      })
      setPrioritiesLoading(true)
      setUser(signedInUser)
      setAuthOpen(false)
      setAuthForm({ username: '', password: '' })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign in.')
    } finally {
      setAuthBusy(false)
    }
  }

  const signOut = async () => {
    setError('')
    try {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
      setMenuOpen(false)
      setPriorities([])
      setPrioritiesLoading(false)
      setMessagesOpen(false)
      setActiveConversation(null)
      setConversationMessages([])
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (offlineMode || editingStrategyId) {
      const localStrategy: Strategy = {
        id: editingStrategyId || crypto.randomUUID(),
        userId: 'offline-local',
        author: 'You',
        title: formData.title.trim(),
        faction: formData.faction.trim() || 'Unclaimed Alliance',
        theatre: formData.theatre || 'global',
        category: formData.category,
        phase: formData.phase,
        summary: formData.summary.trim(),
        steps: formData.steps.split('\n').map((step) => step.trim()).filter(Boolean),
        tags: formData.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        rating: 0,
        shares: 0,
        commentCount: 0,
        createdAt: new Date().toISOString(),
        isLocal: true,
      }
      const nextStrategies = editingStrategyId
        ? strategies.map((strategy) => strategy.id === editingStrategyId ? localStrategy : strategy)
        : [localStrategy, ...strategies]
      persistOfflineStrategies(nextStrategies)
      setStrategies(nextStrategies)
      setFormData(emptyForm)
      setEditingStrategyId(null)
      setComposerOpen(false)
      return
    }
    try {
      const { strategy } = await api<{ strategy: Strategy }>('/strategies', {
        method: 'POST',
        body: JSON.stringify({
          title: formData.title,
          faction: formData.faction || 'Unclaimed Alliance',
          theatre: formData.theatre,
          category: formData.category,
          phase: formData.phase,
          summary: formData.summary,
          steps: formData.steps.split('\n').map((step) => step.trim()).filter(Boolean),
          tags: formData.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        }),
      })
      setStrategies((current) => [strategy, ...current])
      setFormData(emptyForm)
      setComposerOpen(false)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not publish the strategy.')
    }
  }

  const editLocalStrategy = (strategy: Strategy) => {
    setEditingStrategyId(strategy.id)
    setFormData({
      title: strategy.title,
      faction: strategy.faction,
      theatre: getStrategyRegion(strategy),
      category: strategy.category,
      phase: strategy.phase,
      summary: strategy.summary,
      tags: strategy.tags.join(', '),
      steps: strategy.steps.join('\n'),
    })
    setComposerOpen(true)
  }

  const toggleComments = async (strategyId: string) => {
    if (commentsOpen.includes(strategyId)) {
      setCommentsOpen((current) => current.filter((id) => id !== strategyId))
      setCommentsByStrategy((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== strategyId)),
      )
      setCommentDrafts((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => id !== strategyId)),
      )
      return
    }
    setCommentsOpen((current) => [...current, strategyId])
    if (commentsByStrategy[strategyId]) return
    try {
      const { comments } = await api<{ comments: Comment[] }>(`/strategies/${strategyId}/comments`)
      setCommentsByStrategy((current) => ({ ...current, [strategyId]: comments }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load comments.')
    }
  }

  const submitComment = async (event: FormEvent, strategyId: string) => {
    event.preventDefault()
    const body = commentDrafts[strategyId]?.trim()
    if (!body) return
    setError('')
    try {
      const { comment } = await api<{ comment: Comment }>(`/strategies/${strategyId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      setCommentsByStrategy((current) => ({
        ...current,
        [strategyId]: [...(current[strategyId] || []), comment],
      }))
      setCommentDrafts((current) => ({ ...current, [strategyId]: '' }))
      setStrategies((current) =>
        current.map((strategy) =>
          strategy.id === strategyId ? { ...strategy, commentCount: strategy.commentCount + 1 } : strategy,
        ),
      )
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not post the comment.')
    }
  }

  const openConversation = async (recipient: User) => {
    setError('')
    setConversationMessages([])
    setActiveConversation(recipient)
    setUserQuery('')
    setUserResults([])
    try {
      const { messages } = await api<{ user: User; messages: Message[] }>(`/messages/${recipient.id}`)
      setConversationMessages(messages)
      const { conversations: nextConversations } = await api<{ conversations: Conversation[] }>('/messages')
      setConversations(nextConversations)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load the conversation.')
    }
  }

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeConversation || !messageDraft.trim()) return
    setError('')
    try {
      const { message } = await api<{ message: Message }>(`/messages/${activeConversation.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: messageDraft }),
      })
      setConversationMessages((current) => [...current, message])
      setMessageDraft('')
      const { conversations: nextConversations } = await api<{ conversations: Conversation[] }>('/messages')
      setConversations(nextConversations)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send the message.')
    }
  }

  return (
    <div className={highPriorityOpen ? 'app-shell priority-open' : 'app-shell'} style={accentStyle}>
      <div className="logo-background" aria-hidden="true" ref={logoRef}>
        <span className="globe-anchor" ref={globeAnchorRef} />
      </div>
      <div
        className="hologram-globe"
        aria-hidden="true"
        style={{ ...hologramBounds, visibility: highPriorityOpen ? 'hidden' : hologramBounds.visibility }}
      >
        <SpinningGlobeMap />
        <div className="globe-map-fallback" />
        <div className="globe-grid" />
      </div>
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">SW</div>
          <div>
            <p className="eyebrow">Command feed</p>
            <h2>Supremacy War Room</h2>
          </div>
        </div>

        <nav className="header-actions" aria-label="Main navigation">
          {user && !offlineMode ? (
            <button className="ghost-button" type="button" onClick={() => {
              if (messagesOpen) {
                setMessagesOpen(false)
                setActiveConversation(null)
                setConversationMessages([])
              } else {
                setMessagesOpen(true)
              }
            }}>
              Messages
            </button>
          ) : null}
          {user && !offlineMode ? (
            <button className="ghost-button" type="button" onClick={() => setAlliancesOpen((open) => !open)}>
              Alliances
            </button>
          ) : null}
          {user || offlineMode ? (
            <button className="primary-button" type="button" onClick={() => { setEditingStrategyId(null); setFormData(emptyForm); setComposerOpen(true) }}>
              {offlineMode ? 'New strategy' : 'Share strategy'}
            </button>
          ) : null}
          <div className="account-menu" ref={menuRef}>
            <button
              className="account-menu-trigger"
              type="button"
              aria-controls="account-app-menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="account-menu-avatar">{user ? user.username.slice(0, 1).toUpperCase() : '☰'}</span>
              <span>{user ? user.username : 'Menu'}</span>
              <span className="account-menu-chevron" aria-hidden="true">⌄</span>
            </button>
            {menuOpen ? (
              <section id="account-app-menu" className="account-dropdown" aria-label="Account and app settings">
                <div className="dropdown-section">
                  <p className="eyebrow">Commander</p>
                  {user ? (
                    <>
                      <p className="dropdown-user-name">{user.username}</p>
                      {user.createdAt ? <p className="muted-copy">Joined {formatDate(user.createdAt)}</p> : null}
                      <button className="ghost-button dropdown-wide-button" type="button" onClick={signOut}>Sign out</button>
                    </>
                  ) : offlineMode ? (
                    <p className="muted-copy">Offline mode. Sign-in is available when the server reconnects.</p>
                  ) : (
                    <div className="dropdown-button-row">
                      <button className="ghost-button" type="button" onClick={() => { setAuthMode('login'); setAuthOpen(true); setMenuOpen(false) }}>Sign in</button>
                      <button className="primary-button" type="button" onClick={() => { setAuthMode('register'); setAuthOpen(true); setMenuOpen(false) }}>Create account</button>
                    </div>
                  )}
                </div>
                <form className="dropdown-section dropdown-server-form" onSubmit={saveServerUrl}>
                  <p className="eyebrow">Connection</p>
                  <label className="search-field" htmlFor="api-server-url">
                    <span>Custom server URL (optional)</span>
                    <input
                      id="api-server-url"
                      type="url"
                      inputMode="url"
                      placeholder="https://war-room.example.com"
                      value={serverDraft}
                      onChange={(event) => setServerDraft(event.target.value)}
                    />
                  </label>
                  <p className="muted-copy">
                    {configuredServer
                      ? `Configured: ${configuredServer}`
                      : defaultApiBaseUrl
                        ? `Using the built-in public server: ${defaultApiBaseUrl}`
                        : 'Leave blank to use the local development API.'}
                  </p>
                  <div className="dropdown-button-row">
                    <button className="primary-button" type="submit">Save server</button>
                    {configuredServer ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => {
                          localStorage.removeItem('supremacy.apiUrl')
                          setConfiguredServer('')
                          setServerDraft('')
                          setMenuOpen(false)
                          window.location.reload()
                        }}
                      >
                        Use default
                      </button>
                    ) : null}
                  </div>
                </form>
                <div className="dropdown-section appearance-section">
                  <div>
                    <span className="eyebrow">Appearance</span>
                    <span className="dropdown-user-name">Choose an accent</span>
                  </div>
                  <div className="accent-swatch-grid">
                    {accentPresets.map((preset) => (
                      <button
                        key={preset.color}
                        className={accentColor.toLowerCase() === preset.color ? 'accent-swatch selected' : 'accent-swatch'}
                        type="button"
                        aria-label={`${preset.label} accent`}
                        aria-pressed={accentColor.toLowerCase() === preset.color}
                        style={{ backgroundColor: preset.color }}
                        onClick={() => updateAccentColor(preset.color)}
                      />
                    ))}
                    <label
                      className={accentPresets.some((preset) => preset.color === accentColor.toLowerCase()) ? 'accent-swatch accent-custom-swatch' : 'accent-swatch accent-custom-swatch selected'}
                      htmlFor="accent-color-picker"
                      aria-label="Choose a custom accent color"
                    >
                      <span aria-hidden="true">+</span>
                      <input
                        id="accent-color-picker"
                        aria-label="Choose a custom accent color"
                        type="color"
                        value={accentColor}
                        onChange={(event) => updateAccentColor(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="accent-picker-footer">
                    <span className="muted-copy">Your choice is saved on this device.</span>
                    <button className="text-button" type="button" onClick={() => updateAccentColor(defaultAccent)}>
                      Reset
                    </button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </nav>
      </header>

      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error}</span>
          <button type="button" className="close-button" aria-label="Dismiss error" onClick={() => setError('')}>✕</button>
        </div>
      ) : null}

      {offlineMode ? (
        <div className="notice offline-notice" role="status">
          <span><strong>Offline mode.</strong> Your strategies and targets save on this device only. Publishing, comments, and private messages need a server connection.</span>
          <button type="button" className="ghost-button" onClick={() => window.location.reload()}>Retry connection</button>
        </div>
      ) : null}

      {authOpen ? (
        <section className="panel auth-panel" aria-label={authMode === 'login' ? 'Sign in' : 'Create account'}>
          <div className="panel-header">
            <h3>{authMode === 'login' ? 'Welcome back, commander' : 'Create your commander account'}</h3>
            <button type="button" className="close-button" aria-label="Close" onClick={() => setAuthOpen(false)}>✕</button>
          </div>
          <form className="auth-form" onSubmit={submitAuth}>
            <label>
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={24}
                required
                value={authForm.username}
                onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))}
                placeholder="3-24 letters, numbers, _ or -"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                minLength={10}
                maxLength={128}
                required
                value={authForm.password}
                onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="At least 10 characters"
              />
            </label>
            <button className="primary-button wide-button" type="submit" disabled={authBusy}>
              {authBusy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <button
            className="text-button"
            type="button"
            onClick={() => { setError(''); setAuthMode(authMode === 'login' ? 'register' : 'login') }}
          >
            {authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </section>
      ) : null}

      <div className="content-grid">
        <main className="main-panel">
          <section className="hero-panel panel">
            <div className="hero-copy">
              <p className="eyebrow">Tactical intelligence</p>
              <h1>Build a smarter war plan.</h1>
              <p className="hero-text">
                Share production loops, fleet tactics, diplomatic maneuvers, and logistics playbooks
                with your alliance before the next round begins.
              </p>
            </div>
            <div className="stats-grid">
              <div className="stat-card"><span>Plans loaded</span><strong>{strategies.length}</strong></div>
              <div className="stat-card"><span>Avg. rating</span><strong>{globalStats.averageRating}%</strong></div>
              <div className="stat-card"><span>Community reach</span><strong>{globalStats.totalShared}</strong></div>
            </div>
          </section>

          <section className="filter-panel panel">
            <p className="eyebrow feed-label">Command feed</p>
            <div className="priority-tab-row">
              <button
                type="button"
                className={highPriorityOpen ? 'tab-button active' : 'tab-button'}
                aria-haspopup="dialog"
                aria-expanded={highPriorityOpen}
                onClick={() => setHighPriorityOpen(true)}
              >
                High priority
                {priorities.length ? <span className="priority-tab-count">{priorities.length}</span> : null}
              </button>
            </div>
            <label className="search-field" htmlFor="strategy-search">
              <span>Search strategy map</span>
              <input
                id="strategy-search"
                type="search"
                placeholder="Search by tactic, tag, or faction"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (!offlineMode) setLoading(true)
                }}
              />
            </label>
            <div className="tab-row" aria-label="Command feed filters">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={tab === activeTab ? 'tab-button active' : 'tab-button'}
                  aria-pressed={tab === activeTab}
                  onClick={() => {
                    setActiveTab(tab)
                    if (!offlineMode) setLoading(true)
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </section>

          {highPriorityOpen ? (
            <div className="priority-overlay" onMouseDown={() => setHighPriorityOpen(false)}>
            <section
              className="panel priorities-panel priorities-window"
              role="dialog"
              aria-modal="true"
              aria-labelledby="priorities-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="priorities-heading">
                <div>
                  <p className="eyebrow">Command feed / High priority</p>
                  <h3 id="priorities-title">Your high priority targets</h3>
                  <p className="muted-copy">{offlineMode ? 'Saved privately on this device. You can add, edit, and remove targets without a server.' : 'Keep your current objectives together. Only you can see and edit these targets.'}</p>
                </div>
                <div className="priority-window-actions">
                  <span className="priority-count">{priorities.length}/10</span>
                  <button type="button" className="close-button" aria-label="Close high priority targets" onClick={() => setHighPriorityOpen(false)}>✕</button>
                </div>
              </div>
              {user || offlineMode ? (
                <form className="priority-form" onSubmit={submitPriority}>
                  <label className="search-field" htmlFor="priority-draft">
                    <span>Add a target</span>
                    <input
                      id="priority-draft"
                      required
                      maxLength={180}
                      value={priorityDraft}
                      onChange={(event) => setPriorityDraft(event.target.value)}
                      placeholder="Example: Secure the eastern supply corridor by turn 10"
                      disabled={!editingPriorityId && priorities.length >= 10}
                    />
                  </label>
                  <button className="primary-button" type="submit" disabled={!editingPriorityId && priorities.length >= 10}>
                    {editingPriorityId ? 'Save target' : 'Add target'}
                  </button>
                  {editingPriorityId ? <button className="ghost-button" type="button" onClick={() => { setEditingPriorityId(null); setPriorityDraft('') }}>Cancel</button> : null}
                </form>
              ) : (
                <p className="priority-signin">
                  <button type="button" className="text-button" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Sign in</button>
                  {' '}to create your own high priority targets.
                </p>
              )}
              {prioritiesLoading ? <p className="empty-state">Loading your targets…</p> : null}
              {!prioritiesLoading && (user || offlineMode) && priorities.length === 0 ? (
                <p className="empty-state priority-empty">No targets yet. Add your first objective above.</p>
              ) : null}
              <ul className="priority-list">
                {priorities.map((priority, index) => (
                  <li className="priority-item" key={priority.id}>
                    <span className="priority-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="priority-body">{priority.body}</span>
                    {offlineMode ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => { setEditingPriorityId(priority.id); setPriorityDraft(priority.body) }}
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="priority-remove"
                      aria-label={`Remove target: ${priority.body}`}
                      onClick={() => deletePriority(priority.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            </div>
          ) : null}

          {activeTab === 'Map' ? (
            <section className="panel map-panel">
              <div className="panel-header map-header">
                <div>
                  <p className="eyebrow">Theatre map</p>
                  <h3>Operational overview</h3>
                </div>
                <label className="map-region-filter">
                  <span>Region</span>
                  <select
                    value={selectedMapRegion}
                    onChange={(event) => {
                      const nextRegion = event.target.value
                      setSelectedMapRegion(nextRegion)
                      if (nextRegion === 'All') {
                        setSelectedMapStrategyId(null)
                        return
                      }
                      const nextStrategy = mapPanelStrategies.find((strategy) => getStrategyRegion(strategy) === nextRegion)
                      setSelectedMapStrategyId(nextStrategy?.id ?? null)
                    }}
                  >
                    <option value="All">All theatres</option>
                    {mapRegions.map((region) => (
                      <option key={region.id} value={region.id}>{region.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="map-layout">
                <div className="map-viewport" aria-label="World strategy map">
                  <svg viewBox="0 0 1000 500" role="img" aria-labelledby="map-title">
                    <title id="map-title">Strategic theatre map</title>
                    <image href={`${import.meta.env.BASE_URL}globe-map.svg`} x="0" y="0" width="1000" height="500" preserveAspectRatio="xMidYMid meet" opacity="0.96" />
                    {mapRegions.map((region) => {
                      const isActive = selectedMapRegion === 'All' || selectedMapRegion === region.id
                      return (
                        <g key={region.id} className="map-region-group" onClick={() => setSelectedMapRegion(region.id)}>
                          <circle
                            className={isActive ? 'map-region-node active' : 'map-region-node'}
                            cx={region.x}
                            cy={region.y}
                            r={16}
                          />
                          <text className="map-region-label" x={region.x + 18} y={region.y - 12}>{region.name}</text>
                        </g>
                      )
                    })}
                    {mapPanelStrategies.map((strategy) => {
                      const region = mapRegions.find((entry) => entry.id === getStrategyRegion(strategy)) ?? mapRegions[0]
                      const isSelected = selectedMapStrategyId === strategy.id
                      return (
                        <g
                          key={strategy.id}
                          className="map-pin-group"
                          onClick={() => setSelectedMapStrategyId(strategy.id)}
                        >
                          <circle className={isSelected ? 'map-pin map-pin-selected' : 'map-pin'} cx={region.x} cy={region.y + 28} r={isSelected ? 7 : 5} />
                          <circle className="map-pin-ring" cx={region.x} cy={region.y + 28} r={isSelected ? 12 : 9} />
                        </g>
                      )
                    })}
                  </svg>
                </div>

                <div className="map-sidebar">
                  <div className="map-sidebar-header">
                    <p className="eyebrow">{selectedMapRegion === 'All' ? 'All theatres' : mapRegions.find((region) => region.id === selectedMapRegion)?.name}</p>
                    <strong>{mapPanelStrategies.length} plans</strong>
                  </div>
                  {mapPanelStrategies.length === 0 ? (
                    <p className="empty-state">No strategies are active for this region.</p>
                  ) : null}
                  {mapPanelStrategies.map((strategy) => {
                    const region = mapRegions.find((entry) => entry.id === getStrategyRegion(strategy)) ?? mapRegions[0]
                    const isSelected = selectedMapStrategyId === strategy.id
                    return (
                      <button
                        key={strategy.id}
                        type="button"
                        className={isSelected ? 'map-strategy-card selected' : 'map-strategy-card'}
                        onClick={() => setSelectedMapStrategyId(strategy.id)}
                      >
                        <div className="map-card-header">
                          <span className="map-card-category">{strategy.category}</span>
                          <span className="map-card-region">{region.name}</span>
                        </div>
                        <strong>{strategy.title}</strong>
                        <span>{strategy.faction}</span>
                        <small>{strategy.summary}</small>
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>
          ) : (
            <section className="strategy-list">
              {loading || !feedLoaded || feedLoading && strategies.length === 0 ? <div className="panel empty-state">Loading the strategy feed…</div> : null}
              {!loading && feedLoaded && !feedLoading && filteredStrategies.length === 0 ? (
                <div className="panel empty-state">
                  {strategies.length === 0 ? 'No strategies from real users have been shared yet.' : 'No strategies match that search yet.'}
                </div>
              ) : null}
              {filteredStrategies.map((strategy) => {
                const isFavorite = favorites.includes(strategy.id)
                const isOpen = commentsOpen.includes(strategy.id)
                const comments = commentsByStrategy[strategy.id] || []
                return (
                  <article key={strategy.id} className="strategy-card panel">
                    <div className="card-header">
                      <div>
                        <p className="eyebrow">
                          {strategy.category} / {mapRegions.find((region) => region.id === getStrategyRegion(strategy))?.name}
                          {strategy.isLocal ? ' / Saved on this device' : ''}
                        </p>
                        <h3>{strategy.title}</h3>
                      </div>
                      <div className="strategy-card-actions">
                        {strategy.isLocal ? (
                          <button type="button" className="ghost-button" onClick={() => editLocalStrategy(strategy)}>Edit</button>
                        ) : null}
                        {!offlineMode ? (
                          <button
                            type="button"
                            className={isFavorite ? 'favorite favorite-on' : 'favorite'}
                            aria-label={`Toggle favorite for ${strategy.title}`}
                            onClick={() => toggleFavorite(strategy.id)}
                          >★</button>
                        ) : null}
                      </div>
                    </div>
                    <div className="meta-row">
                      <span>By {strategy.author}</span><span>{strategy.faction}</span><span>{strategy.phase} game</span>
                    </div>
                    <p className="strategy-summary">{strategy.summary}</p>
                    {strategy.steps.length > 0 ? (
                      <ol className="steps-list">{strategy.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
                    ) : null}
                    <div className="tag-row">
                      {strategy.tags.map((tag) => <span key={tag} className="tag">#{tag}</span>)}
                    </div>
                    <div className="card-footer">
                      <span>Rating {strategy.rating}%</span>
                      {!offlineMode && !strategy.isLocal ? (
                        <button type="button" className="text-button comment-toggle" onClick={() => toggleComments(strategy.id)}>
                          {isOpen ? 'Hide comments' : 'Comments'} ({strategy.commentCount})
                        </button>
                      ) : null}
                      <span>{strategy.shares} shares</span>
                    </div>
                    {isOpen && !offlineMode && !strategy.isLocal ? (
                      <div className="comments-panel">
                        <h4>After-action discussion</h4>
                        {comments.length ? comments.map((comment) => (
                          <div className="comment-item" key={comment.id}>
                            <strong>{comment.author}</strong>
                            <p>{comment.body}</p>
                            <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                          </div>
                        )) : <p className="muted-copy">No comments yet. Start the discussion.</p>}
                        {user ? (
                          <form className="comment-form" onSubmit={(event) => submitComment(event, strategy.id)}>
                            <textarea
                              required
                              maxLength={1000}
                              rows={2}
                              aria-label="Write a comment"
                              placeholder="Share a counter-strategy or field report…"
                              value={commentDrafts[strategy.id] || ''}
                              onChange={(event) => setCommentDrafts((current) => ({ ...current, [strategy.id]: event.target.value }))}
                            />
                            <button className="primary-button" type="submit">Post comment</button>
                          </form>
                        ) : <button type="button" className="text-button" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>Sign in to comment</button>}
                      </div>
                    ) : null}
                  </article>
                )
              })}
              {feedHasMore ? (
                <button
                  className="ghost-button load-more-button"
                  type="button"
                  onClick={loadMoreStrategies}
                  disabled={feedLoading}
                >
                  {feedLoading ? 'Loading…' : 'Load more strategies'}
                </button>
              ) : null}
            </section>
          )}
        </main>

        <aside className="side-panel">
          {alliancesOpen && user ? (
            <section className="panel messages-panel">
              <div className="panel-header">
                <h3>Alliances</h3>
                <button type="button" className="close-button" aria-label="Close alliances" onClick={() => setAlliancesOpen(false)}>✕</button>
              </div>
              {myAlliance ? (
                <div className="active-chat">
                  <h4>{myAlliance.name}</h4>
                  <p className="muted-copy">{myAlliance.memberCount} / {myAlliance.maxMembers} members</p>
                  <div className="conversation-list">
                    {allianceMembers.map((member) => (
                      <p key={member.userId} className="muted-copy">
                        <strong>{member.username}</strong>{member.userId === myAlliance.ownerId ? ' (leader)' : ''}
                      </p>
                    ))}
                  </div>
                  <button className="ghost-button wide-button" type="button" onClick={() => runAllianceAction('/alliances/leave')}>Leave alliance</button>
                </div>
              ) : (
                <>
                  <form className="message-form" onSubmit={(event) => { event.preventDefault(); runAllianceAction('/alliances', { name: allianceName }) }}>
                    <label className="search-field">
                      <span>Create an alliance</span>
                      <input required minLength={3} maxLength={32} value={allianceName} onChange={(event) => setAllianceName(event.target.value)} placeholder="Alliance name" />
                    </label>
                    <button className="primary-button wide-button" type="submit">Create alliance</button>
                  </form>
                  <label className="search-field">
                    <span>Find an alliance to join</span>
                    <input maxLength={32} value={allianceQuery} onChange={(event) => setAllianceQuery(event.target.value)} placeholder="Search alliances" />
                  </label>
                  <div className="conversation-list">
                    {allianceResults.map((alliance) => {
                      const full = alliance.memberCount >= alliance.maxMembers
                      return (
                        <button key={alliance.id} type="button" className="conversation-button" disabled={full} onClick={() => runAllianceAction(`/alliances/${alliance.id}/join`)}>
                          <span><strong>{alliance.name}</strong><small>{alliance.memberCount} / {alliance.maxMembers} members{full ? ' · Full' : ''}</small></span>
                        </button>
                      )
                    })}
                    {!allianceResults.length ? <p className="muted-copy">No alliances found.</p> : null}
                  </div>
                </>
              )}
            </section>
          ) : null}
          {messagesOpen && user ? (
            <section className="panel messages-panel">
              <div className="panel-header">
                <h3>Private messages</h3>
                <button type="button" className="close-button" aria-label="Close messages" onClick={() => { setMessagesOpen(false); setActiveConversation(null); setConversationMessages([]) }}>✕</button>
              </div>
              <label className="search-field">
                <span>Find a commander</span>
                <input value={userQuery} onChange={(event) => { setUserResults([]); setUserQuery(event.target.value) }} placeholder="Search usernames" />
              </label>
              {userQuery.trim().length >= 2 && userResults.length ? (
                <div className="user-results">
                  {userResults.map((candidate) => (
                    <button key={candidate.id} type="button" className="conversation-button" onClick={() => openConversation(candidate)}>
                      Start chat with <strong>{candidate.username}</strong>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="conversation-list">
                {conversations.map((conversation) => (
                  <button key={conversation.userId} type="button" className="conversation-button" onClick={() => openConversation({ id: conversation.userId, username: conversation.username })}>
                    <span><strong>{conversation.username}</strong><small>{conversation.lastMessage}</small></span>
                    {conversation.unread > 0 ? <b className="unread-badge">{conversation.unread}</b> : null}
                  </button>
                ))}
                  {!conversations.length && !userResults.length && userQuery.trim().length < 2 ? <p className="muted-copy">Search a username to start your first conversation.</p> : null}
              </div>
              {activeConversation ? (
                <div className="active-chat">
                  <h4>Chat with {activeConversation.username}</h4>
                  <div className="message-thread" aria-live="polite">
                    {conversationMessages.map((message) => (
                      <div key={message.id} className={message.senderId === user.id ? 'message-bubble own-message' : 'message-bubble'}>
                        <p>{message.body}</p>
                        <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                      </div>
                    ))}
                    {!conversationMessages.length ? <p className="muted-copy">Send a message to open the conversation.</p> : null}
                  </div>
                  <form className="message-form" onSubmit={submitMessage}>
                    <textarea required maxLength={2000} rows={2} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Write a private message…" />
                    <button className="primary-button wide-button" type="submit">Send message</button>
                  </form>
                </div>
              ) : null}
            </section>
          ) : null}

          {composerOpen && (user || offlineMode) ? (
            <form className="panel composer-form" onSubmit={handleSubmit}>
              <div className="panel-header">
                <h3>{editingStrategyId ? 'Edit saved strategy' : offlineMode ? 'New offline strategy' : 'Share a strategy'}</h3>
                <button type="button" className="close-button" aria-label="Close form" onClick={() => { setComposerOpen(false); setEditingStrategyId(null); setFormData(emptyForm) }}>✕</button>
              </div>
              {offlineMode ? <p className="muted-copy">This plan stays private on this device and won’t be posted to the shared feed.</p> : null}
              <label><span>Title</span><input required maxLength={100} value={formData.title} onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Missile corridor defense" /></label>
              <div className="split-fields">
                <label><span>Faction</span><input maxLength={60} value={formData.faction} onChange={(event) => setFormData((current) => ({ ...current, faction: event.target.value }))} placeholder="Alliance name" /></label>
                <label><span>Category</span>
                  <select value={formData.category} onChange={(event) => setFormData((current) => ({ ...current, category: event.target.value as StrategyCategory }))}>
                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              <label><span>Theatre</span>
                <select
                  required
                  value={formData.theatre}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === '') {
                      setFormData((current) => ({ ...current, theatre: '' }))
                    } else if (isTheatre(value)) {
                      setFormData((current) => ({ ...current, theatre: value }))
                    }
                  }}
                >
                  <option value="">Choose a theatre</option>
                  {mapRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                </select>
              </label>
              <label><span>Phase</span>
                <select value={formData.phase} onChange={(event) => setFormData((current) => ({ ...current, phase: event.target.value as StrategyPhase }))}>
                  <option value="Early">Early</option><option value="Mid">Mid</option><option value="Late">Late</option>
                </select>
              </label>
              <label><span>Summary</span><textarea required maxLength={1500} rows={4} value={formData.summary} onChange={(event) => setFormData((current) => ({ ...current, summary: event.target.value }))} placeholder="Describe the plan in a few lines" /></label>
              <label><span>Tags</span><input value={formData.tags} onChange={(event) => setFormData((current) => ({ ...current, tags: event.target.value }))} placeholder="production, naval, defense" /></label>
              <label><span>Game plan</span><textarea rows={5} value={formData.steps} onChange={(event) => setFormData((current) => ({ ...current, steps: event.target.value }))} placeholder="Add one step per line (up to 8)" /></label>
              <button type="submit" className="primary-button wide-button">
                {editingStrategyId ? 'Save changes' : offlineMode ? 'Save on this device' : 'Publish to feed'}
              </button>
            </form>
          ) : null}
          {!user && !offlineMode ? (
            <div className="panel sign-in-callout">
              <p className="eyebrow">Join the war room</p>
              <h3>Your plan, your alliance.</h3>
              <p className="muted-copy">Create an account to publish strategies, join discussions, and message other commanders.</p>
              <button className="primary-button wide-button" type="button" onClick={() => { setAuthMode('register'); setAuthOpen(true) }}>Create account</button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

export default App
