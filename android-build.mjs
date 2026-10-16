import { copyFile, mkdir } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'

const projectRoot = import.meta.dirname
const androidDirectory = join(projectRoot, 'android')
const releaseBuild = process.argv.includes('--release')
const androidSdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '')
const environment = { ...process.env }

if (releaseBuild) {
  const signingVariables = [
    'ANDROID_KEYSTORE_FILE',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]
  const missingVariables = signingVariables.filter((name) => !environment[name])
  if (missingVariables.length > 0) {
    throw new Error(`Release APK signing requires: ${missingVariables.join(', ')}.`)
  }
  if (!existsSync(environment.ANDROID_KEYSTORE_FILE)) {
    throw new Error(`Android signing keystore was not found at ${environment.ANDROID_KEYSTORE_FILE}.`)
  }
}

if (!environment.ANDROID_HOME && androidSdk) environment.ANDROID_HOME = androidSdk
if (!environment.ANDROID_SDK_ROOT && androidSdk) environment.ANDROID_SDK_ROOT = androidSdk

if (!existsSync(androidSdk)) {
  throw new Error('Android SDK was not found. Set ANDROID_HOME or install it at %LOCALAPPDATA%\\Android\\Sdk.')
}

if (!environment.JAVA_HOME && process.platform === 'win32') {
  const javaRoots = [
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Android Studio', 'jbr') : '',
  ].filter(Boolean)

  for (const root of javaRoots) {
    if (!existsSync(root)) continue
    const directories = root.toLowerCase().endsWith('jbr')
      ? [root]
      : readdirSync(root, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('jdk-21'))
          .map((entry) => join(root, entry.name))
          .sort()
          .reverse()
    environment.JAVA_HOME = directories.find((directory) =>
      existsSync(join(directory, 'bin', 'java.exe')),
    )
    if (environment.JAVA_HOME) break
  }
}

if (process.platform === 'win32' && !environment.JAVA_HOME) {
  throw new Error('JDK 21 was not found. Set JAVA_HOME or install Temurin 21.')
}

for (const [script, args] of [
  ['node_modules/typescript/bin/tsc', ['-b']],
  ['node_modules/vite/bin/vite.js', ['build']],
  ['node_modules/@capacitor/cli/bin/capacitor', ['sync', 'android']],
]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

if (environment.JAVA_HOME) {
  environment.Path = [
    join(environment.JAVA_HOME, 'bin'),
    androidSdk ? join(androidSdk, 'platform-tools') : '',
    environment.Path || '',
  ].filter(Boolean).join(delimiter)
}

const gradleWrapper = join(androidDirectory, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
const buildVariant = releaseBuild ? 'Release' : 'Debug'
const gradle = process.platform === 'win32'
  ? spawnSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/c', `gradlew.bat assemble${buildVariant}`],
      { cwd: androidDirectory, env: environment, stdio: 'inherit' },
    )
  : spawnSync(gradleWrapper, [`assemble${buildVariant}`], {
      cwd: androidDirectory,
      env: environment,
      stdio: 'inherit',
    })
if (gradle.error) throw gradle.error
if (gradle.status !== 0) process.exit(gradle.status || 1)

const apkPath = join(
  projectRoot,
  'android',
  'app',
  'build',
  'outputs',
  'apk',
  releaseBuild ? 'release' : 'debug',
  `app-${releaseBuild ? 'release' : 'debug'}.apk`,
)
const outputDirectory = join(projectRoot, 'release')
const deliveredApk = join(
  outputDirectory,
  `Supremacy War Room${releaseBuild ? ' Release' : ''}.apk`,
)

if (!existsSync(apkPath)) throw new Error(`Gradle completed but the APK was not found at ${apkPath}.`)
await mkdir(outputDirectory, { recursive: true })
await copyFile(apkPath, deliveredApk)
console.log(`${releaseBuild ? 'Signed release' : 'Debug'} Android APK created: ${deliveredApk}`)
