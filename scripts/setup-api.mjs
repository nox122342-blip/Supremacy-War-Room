import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, writeFile } from 'node:fs/promises'
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

try {
  await access(envPath)
  console.error('.env already exists; leaving it unchanged. Edit it to update API configuration.')
  process.exit(1)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const prompt = createInterface({ input: stdin, output: stdout })
let webOrigin
try {
  webOrigin = (await prompt.question('Optional hosted website origin (for example https://warroom.example.com): ')).trim()
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

const sessionSecret = randomBytes(48).toString('hex')
const envFile = [
  `SESSION_SECRET=${sessionSecret}`,
  `CORS_ORIGINS=${webOrigin}`,
  'API_PORT=3001',
  '',
].join('\n')
await writeFile(envPath, envFile, { flag: 'wx', mode: 0o600 })
console.log('Created .env with a new secure session secret.')
console.log('Building and starting the API. The SQLite database will be stored in backend-data/.')

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
