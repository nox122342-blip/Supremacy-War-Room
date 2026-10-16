import { spawnSync } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseDirectory = resolve(projectRoot, 'release')
const outputPath = join(releaseDirectory, 'Supremacy War Room Setup.exe')
const fullInstallerPath = join(releaseDirectory, 'Supremacy War Room Full Setup.exe')
const sourcePath = join(projectRoot, 'scripts', 'desktop-bootstrapper.cs')
const maximumInstallerSize = 25 * 1024 * 1024

await mkdir(releaseDirectory, { recursive: true })
await stat(fullInstallerPath)

const compilerCandidates = [
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]
let compilerPath
for (const candidate of compilerCandidates) {
  try {
    await stat(candidate)
    compilerPath = candidate
    break
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
if (!compilerPath) throw new Error('Could not find the Windows .NET Framework C# compiler (csc.exe).')

const result = spawnSync(
  compilerPath,
  [
    '/nologo',
    '/target:exe',
    '/optimize+',
    `/out:${outputPath}`,
    '/reference:System.Web.Extensions.dll',
    sourcePath,
  ],
  { cwd: projectRoot, stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

const { size } = await stat(outputPath)
if (size >= maximumInstallerSize) {
  throw new Error(`The bootstrap installer is ${size} bytes; it must be smaller than 25 MiB.`)
}
console.log(`GitHub bootstrap installer created (${(size / (1024 * 1024)).toFixed(2)} MiB): ${outputPath}`)
