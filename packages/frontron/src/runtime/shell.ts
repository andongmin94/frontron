import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import { Menu, Tray, type MenuItemConstructorOptions } from 'electron'

import type {
  FrontronDesktopContext,
  FrontronMenuConfig,
  FrontronMenuItemConfig,
  FrontronTrayConfig,
} from '../types'
import type { RuntimeManifest } from './manifest'

function resolveManifestPath(manifestPath: string, value: string | undefined) {
  if (!value) {
    return value
  }

  if (isAbsolute(value)) {
    return value
  }

  return resolve(dirname(manifestPath), value)
}

function createMenuItem(
  item: FrontronMenuItemConfig,
  context: FrontronDesktopContext,
): MenuItemConstructorOptions {
  return {
    type: item.type,
    label: item.label,
    role: item.role as MenuItemConstructorOptions['role'],
    accelerator: item.accelerator,
    enabled: item.enabled,
    checked: item.checked,
    submenu: item.submenu ? buildMenuTemplate(item.submenu, context) : undefined,
    click: item.onClick
      ? () => {
          void Promise.resolve(item.onClick?.(context)).catch((error: unknown) => {
            console.error(error instanceof Error ? error.message : String(error))
          })
        }
      : undefined,
  }
}

export function buildMenuTemplate(
  menu: FrontronMenuConfig,
  context: FrontronDesktopContext,
) {
  return menu.map((item) => createMenuItem(item, context))
}

export function applyConfiguredMenu(
  menu: FrontronMenuConfig | undefined,
  context: FrontronDesktopContext,
) {
  if (!menu || menu.length === 0) {
    if (context.mode === 'production') {
      Menu.setApplicationMenu(null)
    }

    return null
  }

  const builtMenu = Menu.buildFromTemplate(buildMenuTemplate(menu, context))
  Menu.setApplicationMenu(builtMenu)
  return builtMenu
}

export function createConfiguredTray(
  trayConfig: FrontronTrayConfig | undefined,
  manifest: RuntimeManifest,
  manifestPath: string,
  context: FrontronDesktopContext,
) {
  if (!trayConfig) {
    return null
  }

  const trayIconPath = resolveManifestPath(manifestPath, trayConfig.icon ?? manifest.app.icon)

  if (!trayIconPath || !existsSync(trayIconPath)) {
    throw new Error('[Frontron] Tray requires a valid "tray.icon" or "app.icon" path.')
  }

  const tray = new Tray(trayIconPath)

  if (trayConfig.tooltip) {
    tray.setToolTip(trayConfig.tooltip)
  }

  if (trayConfig.items && trayConfig.items.length > 0) {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(trayConfig.items, context)))
  }

  if (trayConfig.onClick) {
    tray.on('click', () => {
      void Promise.resolve(trayConfig.onClick?.(context)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error))
      })
    })
  }

  return tray
}
