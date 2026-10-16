import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const children = [
  spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
  }),
]

let shuttingDown = false

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  process.exitCode = exitCode
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Could not start a development process:', error)
    shutdown(1)
  })
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code || 0)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
