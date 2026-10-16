import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const envPath = new URL('../.env', import.meta.url)

const composeCheck = spawnSync('docker', ['compose', 'version'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
if (composeCheck.error || composeCheck.status !== 0) {
  console.error('Docker Compose is required. Install and start Docker Desktop, then run npm run api:setup again.')
  if (composeCheck.stderr) console.error(composeCheck.stderr.trim())
  process.exit(1)
}

let envFile
try {
  envFile = await readFile(envPath, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  envFile = [
    'SESSION_SECRET=',
    'CORS_ORIGINS=',
    'API_PORT=3001',
    'SUPABASE_URL=https://ckgkfvylkaiyladbxqfp.supabase.co',
    'SUPABASE_SERVICE_ROLE_KEY=',
    '',
  ].join('\n')
}

function getEnvValue(key) {
  const line = envFile.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') : ''
}

function setEnvValue(key, value) {
  const line = `${key}=${value}`
  const expression = new RegExp(`^${key}=.*$`, 'm')
  envFile = expression.test(envFile)
    ? envFile.replace(expression, line)
    : `${envFile.trimEnd()}\n${line}\n`
}

const prompt = createInterface({ input: stdin, output: stdout })
let webOrigin
try {
  webOrigin = (await prompt.question('Optional hosted website origin (Enter to keep current CORS settings): ')).trim()
} finally {
  prompt.close()
}

if (webOrigin) {
  let parsedOrigin
  try {
    parsedOrigin = new URL(webOrigin)
  } catch {
    console.error('Enter a valid website origin, including https://.')
    process.exit(1)
  }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== webOrigin) {
    console.error('Enter only the website origin, such as https://warroom.example.com (no path).')
    process.exit(1)
  }
}

if (getEnvValue('SESSION_SECRET').length < 32 || getEnvValue('SESSION_SECRET').startsWith('replace-with-')) {
  setEnvValue('SESSION_SECRET', randomBytes(48).toString('hex'))
}
if (!getEnvValue('API_PORT')) setEnvValue('API_PORT', '3001')
if (webOrigin) {
  const origins = getEnvValue('CORS_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean)
  if (!origins.includes(webOrigin)) origins.push(webOrigin)
  setEnvValue('CORS_ORIGINS', origins.join(','))
}

const supabaseUrl = getEnvValue('SUPABASE_URL')
const serviceRoleKey = getEnvValue('SUPABASE_SERVICE_ROLE_KEY')
const missingSupabaseConfig = !supabaseUrl || !serviceRoleKey || /your-project|your-service-role-key/i.test(`${supabaseUrl} ${serviceRoleKey}`)
await writeFile(envPath, envFile, { mode: 0o600 })
if (missingSupabaseConfig) {
  console.error('Saved .env with a secure session secret. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env, then run npm run api:setup again.')
  process.exit(1)
}

console.log('Saved API settings in .env. The Supabase service-role key remains server-side.')
console.log('Building and starting the API.')

const docker = spawn('docker', ['compose', 'up', '--build', '-d'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
})

docker.on('error', (error) => {
  console.error(`Could not start Docker Compose: ${error.message}`)
  console.error('Install and start Docker Desktop, then run npm run api:setup again.')
  process.exitCode = 1
})

docker.on('exit', (code) => {
  if (code !== 0) {
    console.error('Docker Compose could not start the API. Check Docker Desktop and try npm run api:setup again.')
    process.exitCode = code ?? 1
    return
  }
  console.log('API started. Health check: http://localhost:3001/api/health')
  console.log('Use npm run api:logs to follow logs and npm run api:stop to stop the server.')
})
