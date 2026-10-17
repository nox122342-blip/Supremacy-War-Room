import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import bcrypt from "npm:bcryptjs@3.0.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase server environment is not configured.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const allowedOrigins = new Set([
  "https://nox122342-blip.github.io",
  "https://localhost",
  "capacitor://localhost",
  "supremacy://app",
  ...(Deno.env.get("CORS_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
const categories = new Set(["Economy", "Warfare", "Diplomacy", "Logistics"]);
const phases = new Set(["Early", "Mid", "Late"]);
const theatres = new Set([
  "north-america", "south-america", "europe", "middle-east", "africa",
  "asia-pacific", "global",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attempts = new Map<string, { count: number; expires: number }>();
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

type User = { id: string; username: string; createdAt: string };
type StrategyRow = {
  id: string;
  user_id: string;
  title: string;
  faction: string;
  theatre: string;
  category: string;
  phase: string;
  summary: string;
  steps_json: string[] | string;
  tags_json: string[] | string;
  rating: number;
  shares: number;
  created_at: string;
  author: string;
  comment_count: number;
};

function json(data: unknown, status = 200, origin?: string, extraHeaders: HeadersInit = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function publicUser(user: User) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

function cleanText(value: unknown, maximum: number, field: string, minimum = 1) {
  if (typeof value !== "string") return `${field} must be text.`;
  const cleaned = value.trim();
  if (cleaned.length < minimum || cleaned.length > maximum) {
    return `${field} must be ${minimum}-${maximum} characters.`;
  }
  return null;
}

function serializeStrategy(row: StrategyRow) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    author: row.author,
    faction: row.faction,
    theatre: row.theatre,
    category: row.category,
    phase: row.phase,
    summary: row.summary,
    steps: Array.isArray(row.steps_json) ? row.steps_json : JSON.parse(row.steps_json),
    tags: Array.isArray(row.tags_json) ? row.tags_json : JSON.parse(row.tags_json),
    rating: row.rating,
    shares: row.shares,
    commentCount: Number(row.comment_count ?? 0),
    createdAt: row.created_at,
  };
}

async function requestBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16 * 1024) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16 * 1024) return null;
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function createSession(userId: string) {
  const accessToken = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  const { error } = await db.from("sessions").insert({
    sid: accessToken,
    sess: { userId },
    expire: Date.now() + sessionLifetime,
  });
  if (error) throw error;
  return accessToken;
}

async function authenticatedUser(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f-]{36}[0-9a-f]{32})$/i)?.[1];
  if (!token) return null;
  const { data, error } = await db.from("sessions")
    .select("sess, expire")
    .eq("sid", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.expire <= Date.now()) {
    const { error: deleteError } = await db.from("sessions").delete().eq("sid", token);
    if (deleteError) throw deleteError;
    return null;
  }
  const { error: touchError } = await db.from("sessions")
    .update({ expire: Date.now() + sessionLifetime })
    .eq("sid", token);
  if (touchError) throw touchError;
  return typeof data.sess?.userId === "string" ? data.sess.userId : null;
}

async function getUser(id: string) {
  const { data, error } = await db.from("users")
    .select("id, username, created_at")
    .eq("id", id)
    .eq("is_demo", false)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, username: data.username, createdAt: data.created_at } as User : null;
}

async function userByUsername(username: string) {
  const escapedUsername = username.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await db.from("users")
    .select("id, username, created_at, password_hash, is_demo")
    .ilike("username", escapedUsername)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function strategy(id: string) {
  const { data, error } = await db.from("strategy_feed")
    .select("id, user_id, title, faction, theatre, category, phase, summary, steps_json, tags_json, rating, shares, created_at, author, comment_count")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as StrategyRow | null;
}

async function rateLimit(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  for (const [key, attempt] of attempts) {
    if (attempt.expires <= now) attempts.delete(key);
  }
  const attempt = attempts.get(ip);
  if (attempt && attempt.expires > now && attempt.count >= 10) return false;
  if (!attempt || attempt.expires <= now) attempts.set(ip, { count: 1, expires: now + 15 * 60 * 1000 });
  else attempt.count++;
  return true;
}

function resetRateLimit(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  attempts.delete(ip);
}

async function handle(request: Request, origin?: string) {
  const url = new URL(request.url);
  const endpoint = url.pathname.replace(/^.*\/api(?=\/|$)/, "") || "/";
  const method = request.method;

  if (method === "GET" && endpoint === "/health") {
    const { error } = await db.from("users").select("id").limit(1);
    if (error) throw error;
    return json({ status: "ok" }, 200, origin);
  }

  if (method === "POST" && ["/auth/register", "/auth/login"].includes(endpoint)) {
    if (!await rateLimit(request)) {
      return json({ error: "Too many sign-in attempts. Please try again in 15 minutes." }, 429, origin);
    }
    const body = await requestBody(request);
    if (!body) return json({ error: "Request body must be a JSON object." }, 400, origin);

    if (endpoint === "/auth/register") {
      const usernameError = cleanText(body.username, 24, "Username", 3);
      const passwordError = cleanText(body.password, 128, "Password", 10);
      if (usernameError || passwordError) {
        return json({ error: usernameError || passwordError }, 400, origin);
      }
      const username = (body.username as string).trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return json({
          error: "Username can only contain letters, numbers, underscores, and hyphens.",
        }, 400, origin);
      }
      if (await userByUsername(username)) {
        return json({ error: "That username is already taken." }, 409, origin);
      }
      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(body.password as string, 12);
      const { data, error } = await db.from("users")
        .insert({ id: userId, username, password_hash: passwordHash })
        .select("id, username, created_at")
        .single();
      if (error?.code === "23505") {
        return json({ error: "That username is already taken." }, 409, origin);
      }
      if (error) throw error;
      const accessToken = await createSession(userId);
      resetRateLimit(request);
      return json({
        user: { id: data.id, username: data.username, createdAt: data.created_at },
        accessToken,
      }, 201, origin);
    }

    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return json({ error: "Enter your username and password." }, 400, origin);
    }
    const user = await userByUsername(body.username.trim());
    if (!user || user.is_demo || !await bcrypt.compare(body.password, user.password_hash)) {
      return json({ error: "Username or password is incorrect." }, 401, origin);
    }
    const accessToken = await createSession(user.id);
    resetRateLimit(request);
    return json({
      user: { id: user.id, username: user.username, createdAt: user.created_at },
      accessToken,
    }, 200, origin);
  }

  const userId = await authenticatedUser(request);

  if (method === "GET" && endpoint === "/auth/me") {
    if (!userId) return json({ user: null }, 200, origin);
    const user = await getUser(userId);
    if (!user) return json({ user: null }, 200, origin);
    return json({ user: publicUser(user) }, 200, origin);
  }

  if (method === "POST" && endpoint === "/auth/logout") {
    if (!userId) return json({ error: "Sign in to continue." }, 401, origin);
    const token = request.headers.get("authorization")!.slice("Bearer ".length);
    const { error } = await db.from("sessions").delete().eq("sid", token);
    if (error) throw error;
    return new Response(null, { status: 204, headers: origin ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
    } : {} });
  }

  if (method === "GET" && endpoint === "/strategies") {
    const rawLimit = Number.parseInt(url.searchParams.get("limit") || "", 10) || 24;
    const rawOffset = Number.parseInt(url.searchParams.get("offset") || "", 10) || 0;
    const limit = Math.min(Math.max(rawLimit, 1), 50);
    const offset = Math.max(rawOffset, 0);
    const query = (url.searchParams.get("query") || "").trim().slice(0, 100);
    const requestedCategory = url.searchParams.get("category") || "";
    const category = categories.has(requestedCategory) ? requestedCategory : null;
    const { data, error } = await db.rpc("search_strategy_feed", {
      p_query: query || null,
      p_category: category,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    const strategies = (data.strategies || []).map(serializeStrategy);
    const total = Number(data.total);
    return json({ strategies, total, hasMore: offset + strategies.length < total }, 200, origin);
  }

  if (method === "POST" && endpoint === "/strategies") {
    if (!userId) return json({ error: "Sign in to continue." }, 401, origin);
    const body = await requestBody(request);
    if (!body) return json({ error: "Request body must be a JSON object." }, 400, origin);
    const { title, faction, theatre, category, phase, summary, steps, tags } = body;
    const validationError = cleanText(title, 100, "Title") ||
      cleanText(faction, 60, "Faction") ||
      cleanText(summary, 1500, "Summary");
    if (validationError) return json({ error: validationError }, 400, origin);
    if (!theatres.has(theatre as string) || !categories.has(category as string) || !phases.has(phase as string)) {
      return json({ error: "Choose a valid theatre, category, and phase." }, 400, origin);
    }
    if (!Array.isArray(steps) || steps.length > 8 ||
      steps.some((step) => typeof step !== "string" || !step.trim() || step.length > 300)) {
      return json({
        error: "Game plan must contain up to 8 steps, each no longer than 300 characters.",
      }, 400, origin);
    }
    if (!Array.isArray(tags) || tags.length > 8 ||
      tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 32)) {
      return json({ error: "Tags must contain up to 8 entries, each no longer than 32 characters." }, 400, origin);
    }
    const { data, error } = await db.from("strategies").insert({
      id: crypto.randomUUID(),
      user_id: userId,
      title: (title as string).trim(),
      faction: (faction as string).trim(),
      theatre,
      category,
      phase,
      summary: (summary as string).trim(),
      steps_json: steps.map((step: string) => step.trim()),
      tags_json: tags.map((tag: string) => tag.trim().toLowerCase()),
    }).select("id").single();
    if (error) throw error;
    const created = await strategy(data.id);
    return json({ strategy: serializeStrategy(created!) }, 201, origin);
  }

  const currentUser = userId;
  if (method === "GET" && endpoint === "/priorities") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const { data, error } = await db.from("priorities")
      .select("id, body, created_at")
      .eq("user_id", currentUser)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;
    return json({ priorities: data.map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at })) }, 200, origin);
  }

  if (method === "POST" && endpoint === "/priorities") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const body = await requestBody(request);
    if (!body) return json({ error: "Request body must be a JSON object." }, 400, origin);
    const validationError = cleanText(body.body, 180, "Target");
    if (validationError) return json({ error: validationError }, 400, origin);
    const { data, error } = await db.rpc("create_priority", {
      p_id: crypto.randomUUID(),
      p_user_id: currentUser,
      p_body: (body.body as string).trim(),
    });
    if (error?.code === "P0001" && error.message === "PRIORITY_LIMIT_REACHED") {
      return json({ error: "You can keep up to 10 high priority targets at a time." }, 409, origin);
    }
    if (error) throw error;
    const priority = Array.isArray(data) ? data[0] : data;
    return json({ priority: { id: priority.id, body: priority.body, createdAt: priority.created_at } }, 201, origin);
  }

  const priorityMatch = endpoint.match(/^\/priorities\/([^/]+)$/);
  if (method === "DELETE" && priorityMatch) {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    if (!uuidPattern.test(priorityMatch[1])) return json({ error: "High priority target not found." }, 404, origin);
    const { data, error } = await db.from("priorities").delete()
      .eq("id", priorityMatch[1]).eq("user_id", currentUser).select("id");
    if (error) throw error;
    if (!data.length) return json({ error: "High priority target not found." }, 404, origin);
    return new Response(null, { status: 204, headers: origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {} });
  }

  const ownedDelete = endpoint.match(/^\/(strategies|comments)\/([^/]+)$/);
  if (method === "DELETE" && ownedDelete) {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const label = ownedDelete[1] === "strategies" ? "Strategy" : "Comment";
    if (!uuidPattern.test(ownedDelete[2])) return json({ error: `${label} not found.` }, 404, origin);
    const { data, error } = await db.from(ownedDelete[1]).delete()
      .eq("id", ownedDelete[2]).eq("user_id", currentUser).select("id");
    if (error) throw error;
    if (!data.length) return json({ error: `${label} not found.` }, 404, origin);
    return new Response(null, { status: 204, headers: origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {} });
  }

  const commentsMatch = endpoint.match(/^\/strategies\/([^/]+)\/comments$/);
  if (commentsMatch && (method === "GET" || method === "POST")) {
    const strategyId = commentsMatch[1];
    if (!uuidPattern.test(strategyId)) return json({ error: "Strategy not found." }, 404, origin);
    if (!await strategy(strategyId)) return json({ error: "Strategy not found." }, 404, origin);
    if (method === "GET") {
      const { data, error } = await db.from("comments")
        .select("id, body, created_at, user_id, users!comments_user_id_fkey(username)")
        .eq("strategy_id", strategyId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return json({
        comments: data.map((row) => ({
          id: row.id, body: row.body, createdAt: row.created_at, userId: row.user_id,
          author: row.users.username,
        })),
      }, 200, origin);
    }
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const body = await requestBody(request);
    if (!body) return json({ error: "Request body must be a JSON object." }, 400, origin);
    const validationError = cleanText(body.body, 1000, "Comment");
    if (validationError) return json({ error: validationError }, 400, origin);
    const { data, error } = await db.from("comments")
      .insert({ id: crypto.randomUUID(), strategy_id: strategyId, user_id: currentUser, body: (body.body as string).trim() })
      .select("id, body, created_at, user_id, users!comments_user_id_fkey(username)")
      .single();
    if (error) throw error;
    return json({
      comment: {
        id: data.id, body: data.body, createdAt: data.created_at, userId: data.user_id,
        author: data.users.username,
      },
    }, 201, origin);
  }

  if (method === "GET" && endpoint === "/users") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const query = (url.searchParams.get("query") || "").trim();
    if (query.length < 2 || query.length > 24) return json({ users: [] }, 200, origin);
    const escapedQuery = query.replace(/[\\%_]/g, "\\$&");
    const { data, error } = await db.from("users").select("id, username")
      .neq("id", currentUser).eq("is_demo", false)
      .ilike("username", `%${escapedQuery}%`).order("username").limit(10);
    if (error) throw error;
    return json({ users: data }, 200, origin);
  }

  if (method === "GET" && endpoint === "/messages") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const { data, error } = await db.rpc("list_message_conversations", { p_user_id: currentUser });
    if (error) throw error;
    return json({
      conversations: data.map((row) => ({
        userId: row.user_id,
        username: row.username,
        lastMessage: row.last_message,
        lastMessageAt: row.last_message_at,
        unread: Number(row.unread),
      })),
    }, 200, origin);
  }

  const conversationMatch = endpoint.match(/^\/messages\/([^/]+)$/);
  if (conversationMatch && (method === "GET" || method === "POST")) {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const otherUserId = conversationMatch[1];
    if (!uuidPattern.test(otherUserId)) return json({ error: "User not found." }, 404, origin);
    const otherUser = await getUser(otherUserId);
    if (!otherUser || otherUser.id === currentUser) return json({ error: "User not found." }, 404, origin);

    if (method === "GET") {
      const { data, error } = await db.from("messages").select("id, sender_id, recipient_id, body, created_at")
        .or(`and(sender_id.eq.${currentUser},recipient_id.eq.${otherUser.id}),and(sender_id.eq.${otherUser.id},recipient_id.eq.${currentUser})`)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(200);
      if (error) throw error;
      const { error: readError } = await db.from("messages").update({ read_at: new Date().toISOString() })
        .eq("sender_id", otherUser.id).eq("recipient_id", currentUser).is("read_at", null);
      if (readError) throw readError;
      return json({
        user: publicUser(otherUser),
        messages: data.map((row) => ({
          id: row.id, senderId: row.sender_id, recipientId: row.recipient_id,
          body: row.body, createdAt: row.created_at,
        })),
      }, 200, origin);
    }

    const body = await requestBody(request);
    if (!body) return json({ error: "Request body must be a JSON object." }, 400, origin);
    const validationError = cleanText(body.body, 2000, "Message");
    if (validationError) return json({ error: validationError }, 400, origin);
    const { data, error } = await db.from("messages").insert({
      id: crypto.randomUUID(), sender_id: currentUser, recipient_id: otherUser.id,
      body: (body.body as string).trim(),
    }).select("id, sender_id, recipient_id, body, created_at").single();
    if (error) throw error;
    return json({
      message: {
        id: data.id, senderId: data.sender_id, recipientId: data.recipient_id,
        body: data.body, createdAt: data.created_at,
      },
    }, 201, origin);
  }

  const allianceErrors: Record<string, [number, string]> = {
    already_member: [409, "Leave your current alliance first."],
    name_taken: [409, "That alliance name is already taken."],
    not_found: [404, "Alliance not found."],
    full: [409, "This alliance is full (128 members maximum)."],
    not_member: [404, "You are not in an alliance."],
  };
  const mapAlliance = (row: Record<string, unknown>) => ({
    id: row.id, name: row.name, ownerId: row.owner_id, createdAt: row.created_at,
    memberCount: Number(row.member_count ?? 0), maxMembers: 128,
  });
  const currentAlliance = async (uid: string) => {
    const { data: membership, error } = await db.from("alliance_members")
      .select("alliance_id").eq("user_id", uid).maybeSingle();
    if (error) throw error;
    if (!membership) return { alliance: null, members: [] };
    const { data, error: allianceError } = await db.from("alliances")
      .select("id, name, owner_id, created_at, alliance_members(count)")
      .eq("id", membership.alliance_id).maybeSingle();
    if (allianceError) throw allianceError;
    const { data: members, error: membersError } = await db.from("alliance_members")
      .select("user_id, joined_at, users!alliance_members_user_id_fkey(username)")
      .eq("alliance_id", membership.alliance_id)
      .order("joined_at").order("user_id");
    if (membersError) throw membersError;
    return {
      alliance: data ? mapAlliance({ ...data, member_count: data.alliance_members?.[0]?.count }) : null,
      members: members.map((row) => ({
        userId: row.user_id, username: row.users.username, joinedAt: row.joined_at,
      })),
    };
  };
  const allianceStatus = (status: string) => {
    const [code, error] = allianceErrors[status] || [500, "The server could not complete that request."];
    return json({ error }, code, origin);
  };

  if (endpoint === "/alliances" && method === "GET") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const query = (url.searchParams.get("query") || "").trim().slice(0, 32);
    const { data, error } = await db.rpc("list_alliances", { p_query: query || null, p_limit: 50 });
    if (error) throw error;
    return json({ alliances: data.map(mapAlliance) }, 200, origin);
  }

  if (endpoint === "/alliances/me" && method === "GET") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    return json(await currentAlliance(currentUser), 200, origin);
  }

  if (endpoint === "/alliances" && method === "POST") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const body = await requestBody(request);
    if (!body) return json({ error: "Request body must be a JSON object." }, 400, origin);
    const validationError = cleanText(body.name, 32, "Alliance name", 3);
    if (validationError) return json({ error: validationError }, 400, origin);
    const name = (body.name as string).trim();
    if (!/^[a-zA-Z0-9 _-]+$/.test(name)) {
      return json({
        error: "Alliance name can only contain letters, numbers, spaces, underscores, and hyphens.",
      }, 400, origin);
    }
    const { data, error } = await db.rpc("create_alliance", {
      p_id: crypto.randomUUID(), p_user_id: currentUser, p_name: name,
    });
    if (error) throw error;
    if (data !== "ok") return allianceStatus(data);
    return json(await currentAlliance(currentUser), 201, origin);
  }

  if (endpoint === "/alliances/leave" && method === "POST") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    const { data, error } = await db.rpc("leave_alliance", { p_user_id: currentUser });
    if (error) throw error;
    if (data !== "ok") return allianceStatus(data);
    return json({ alliance: null, members: [] }, 200, origin);
  }

  const joinMatch = endpoint.match(/^\/alliances\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    if (!currentUser) return json({ error: "Sign in to continue." }, 401, origin);
    if (!uuidPattern.test(joinMatch[1])) return json({ error: "Alliance not found." }, 404, origin);
    const { data, error } = await db.rpc("join_alliance", {
      p_alliance_id: joinMatch[1], p_user_id: currentUser,
    });
    if (error) throw error;
    if (data !== "ok") return allianceStatus(data);
    return json(await currentAlliance(currentUser), 200, origin);
  }

  return json({ error: "Not found." }, 404, origin);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || undefined;
  if (origin && !allowedOrigins.has(origin)) {
    return json({ error: "This application origin is not allowed by the API." }, 403);
  }
  if (request.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin || "null",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Vary": "Origin",
    },
  });
  try {
    return await handle(request, origin);
  } catch (error) {
    console.error("API request failed:", error instanceof Error ? error.message : error);
    return json({ error: "The server could not complete that request." }, 500, origin);
  }
});
