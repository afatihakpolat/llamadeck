import { app, shell, BrowserWindow, nativeTheme, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { USER_DATA_ROOT } from './userData'
import {
  broadcastToRenderer,
  createAppCliCommandHandler,
  registerIpcHandlers,
  shutdownManagedProcesses
} from './ipc'
import { existsSync } from 'fs'
import { getAppWindowBehaviorSettings } from './appSettings'
import {
  checkForUpdates,
  getUpdatePreferences,
  initUpdateManager
} from './updateManager'
import { startCliServer, type CliServerHandle } from './cliServer'

let isShuttingDown = false
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let cliServer: CliServerHandle | null = null
const LIGHT_WINDOW_BACKGROUND = '#f3f6fb'
const DARK_WINDOW_BACKGROUND = '#0b1220'

function getInitialWindowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND
}

function resolveIcon(): string | undefined {
  const candidates = [
    join(process.cwd(), 'assets', 'icon.png'),
    join(__dirname, '../../assets/icon.png'),
    join(app.getAppPath(), 'assets', 'icon.png'),
    join(process.resourcesPath, 'app.asar', 'assets', 'icon.png'),
    join(process.resourcesPath, 'assets', 'icon.png'),
    join(process.resourcesPath, 'app.asar', 'assets', 'icon_256.png'),
    join(process.resourcesPath, 'assets', 'icon_256.png')
  ]

  return candidates.find(existsSync)
}

function destroyTray(): void {
  if (!tray) return

  tray.destroy()
  tray = null
}

function showMainWindow(): void {
  if (!mainWindow) return

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
  destroyTray()
}

function ensureTray(): Tray | null {
  if (tray) return tray

  const iconPath = resolveIcon()
  if (!iconPath) return null

  const trayIcon = nativeImage.createFromPath(iconPath)
  if (trayIcon.isEmpty()) {
    return null
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
  tray.setToolTip('LlamaDeck')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open LlamaDeck',
      click: () => showMainWindow()
    },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]))
  tray.on('click', () => showMainWindow())

  return tray
}

function createWindow(): void {
  const icon = resolveIcon()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: getInitialWindowBackground(),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.on('show', () => {
    destroyTray()
  })
  mainWindow.on('close', (event) => {
    if (isShuttingDown) return
    if (!getAppWindowBehaviorSettings().minimizeToTray) return

    const appTray = ensureTray()
    if (!appTray) return

    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https:') || details.url.startsWith('http:')) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.includes('localhost:') && !url.includes('127.0.0.1:')) {
      event.preventDefault()
    }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  showMainWindow()
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.llamadeck.app')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  app.on('before-quit', (event) => {
    if (isShuttingDown) return

    isShuttingDown = true
    event.preventDefault()
    void Promise.all([
      cliServer?.close() ?? Promise.resolve(),
      shutdownManagedProcesses()
    ]).finally(() => {
      app.quit()
    })
  })
  await initUpdateManager({ broadcast: broadcastToRenderer }).catch((err) => {
    console.warn('[update] init failed, in-app updates disabled:', err)
  })
  if (getUpdatePreferences().checkOnLaunch && app.isPackaged) {
    setImmediate(() => {
      void checkForUpdates().catch((err) => {
        console.warn('[update] initial check failed:', err)
      })
    })
  }
  registerIpcHandlers()
  createWindow()
  if (process.platform === 'win32') {
    cliServer = await startCliServer({
      userDataDir: USER_DATA_ROOT,
      handleRequest: createAppCliCommandHandler(showMainWindow)
    }).catch((error) => {
      console.warn('[cli] server failed to start:', error)
      return null
    })
  }
  app.on('activate', function () {
    if (mainWindow) {
      showMainWindow()
      return
    }

    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
