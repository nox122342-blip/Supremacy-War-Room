import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const projectRoot = import.meta.dirname
const externalOutput = join(
  process.env.LOCALAPPDATA || tmpdir(),
  'SupremacyWarRoom',
  'installer-build',
)
const projectOutput = resolve(projectRoot, 'release')

await mkdir(externalOutput, { recursive: true })
const result = spawnSync(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--win',
    'nsis',
    '--publish',
    'never',
    `--config.directories.output=${externalOutput}`,
  ],
  { cwd: projectRoot, stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)

const { version } = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
const installerName = (await readdir(externalOutput)).find(
  (name) => name === `Supremacy War Room Setup ${version}.exe`,
)
if (!installerName) throw new Error(`Windows installer was not produced in ${externalOutput}.`)

await mkdir(projectOutput, { recursive: true })
const installerPath = join(externalOutput, installerName)
const deliveredInstaller = join(projectOutput, 'Supremacy War Room Setup.exe')
await copyFile(installerPath, deliveredInstaller)
console.log(`Windows installer created: ${deliveredInstaller}`)
