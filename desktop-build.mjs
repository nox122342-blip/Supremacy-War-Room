import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const projectRoot = import.meta.dirname
const externalOutput = join(
  process.env.LOCALAPPDATA || tmpdir(),
  'SupremacyWarRoom',
  'installer-build',
)
const projectOutput = resolve(projectRoot, 'release')

const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const repository = process.env.GITHUB_REPOSITORY || 'nox122342-blip/Supremacy-War-Room'
const packageName = `supremacy-strategy-app-${version}-x64.nsis.7z`
const packageUrl = `https://github.com/${repository}/releases/download/v${version}/${packageName}`

await rm(externalOutput, { recursive: true, force: true })
await mkdir(externalOutput, { recursive: true })
const result = spawnSync(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--win',
    'nsis-web',
    '--publish',
    'never',
    `--config.directories.output=${externalOutput}`,
    `--config.nsisWeb.appPackageUrl=${packageUrl}`,
  ],
  { cwd: projectRoot, stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

const webOutput = join(externalOutput, 'nsis-web')
const files = await readdir(webOutput)
const stub = files.find((name) => name === `Supremacy-War-Room-${version}-x64.exe`)
const appPackage = files.find((name) => name.endsWith('-x64.nsis.7z'))
if (!stub || appPackage !== packageName) throw new Error(`Web installer files were not produced in ${webOutput}.`)

await mkdir(projectOutput, { recursive: true })
await copyFile(join(webOutput, stub), join(projectOutput, 'Supremacy-War-Room-Setup.exe'))
await copyFile(join(webOutput, appPackage), join(projectOutput, appPackage))
console.log(`Web installer created: ${join(projectOutput, 'Supremacy-War-Room-Setup.exe')} (downloads ${packageUrl})`)
