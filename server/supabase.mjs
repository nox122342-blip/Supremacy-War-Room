import { createClient } from '@supabase/supabase-js'

let client

export function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!supabaseUrl || !serviceRoleKey || /^(PASTE_SERVER_ONLY_SERVICE_ROLE_KEY_HERE|your-service-role-key)$/i.test(serviceRoleKey)) {
    throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before using Supabase.')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(supabaseUrl)
  } catch (error) {
    throw new Error('SUPABASE_URL must be a valid URL.', { cause: error })
  }

  const usesLocalHttp = parsedUrl.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname)
  if (
    (parsedUrl.protocol !== 'https:' && !usesLocalHttp) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== '/' ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error('SUPABASE_URL must be the project URL, such as https://your-project.supabase.co.')
  }

  if (!client) {
    client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return client
}
