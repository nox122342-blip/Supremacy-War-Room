import { app, BrowserWindow, protocol, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'supremacy',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.whenReady().then(async () => {
  if (!hasInstanceLock) return
  const staticRoot = resolve(app.getAppPath(), 'dist')

  protocol.handle('supremacy', async (request) => {
    const requestedPath = decodeURIComponent(new URL(request.url).pathname)
    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1)
    const filePath = resolve(staticRoot, relativePath)
    if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) {
      return new Response('Not found', { status: 404 })
    }
    try {
      const body = await readFile(filePath)
      return new Response(body, {
        headers: { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' },
      })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        return new Response('Not found', { status: 404 })
      }
      throw error
    }
  })

  const createWindow = () => {
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 360,
      minHeight: 640,
      backgroundColor: '#020817',
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    window.once('ready-to-show', () => window.show())
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://github.com/')) shell.openExternal(url)
      return { action: 'deny' }
    })
    window.loadURL('supremacy://app/')
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
