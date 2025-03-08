import { expect, test, vi } from 'vitest'

import { buildMenuTemplate } from '../src/runtime/shell'
import type { FrontronDesktopContext } from '../src/types'

function createDesktopContext(): FrontronDesktopContext {
  return {
    rootDir: '/fixture',
    mode: 'development',
    app: {
      quit() {},
    },
    shell: {
      async openExternal() {},
    },
    window: {
      show() {},
      hide() {},
      focus() {},
      minimize() {},
      toggleMaximize() {},
      getState() {
        return {
          isMaximized: false,
          isMinimized: false,
        }
      },
    },
    windows: {
      async open() {},
      async show() {},
      hide() {},
      focus() {},
      close() {},
      minimize() {},
      toggleMaximize() {},
      exists() {
        return false
      },
      getState() {
        return null
      },
      listConfigured() {
        return ['main']
      },
      listOpen() {
        return []
      },
    },
    deepLinks: {
      getState() {
        return {
          enabled: false,
          schemes: [],
          pending: [],
        }
      },
      consumePending() {
        return []
      },
    },
    updates: {
      getState() {
        return {
          enabled: false,
          supported: false,
          status: 'disabled',
          currentVersion: '0.0.0',
        }
      },
      async check() {
        return {
          enabled: false,
          supported: false,
          status: 'disabled',
          currentVersion: '0.0.0',
        }
      },
      quitAndInstall() {
        return false
      },
    },
  }
}

test('buildMenuTemplate wires nested config click handlers to desktop context', async () => {
  const onClick = vi.fn()
  const context = createDesktopContext()
  const template = buildMenuTemplate(
    [
      {
        label: 'Window',
        submenu: [
          {
            label: 'Show',
            onClick,
          },
        ],
      },
    ],
    context,
  )

  const submenu = template[0].submenu

  if (!Array.isArray(submenu)) {
    throw new Error('Expected submenu array.')
  }

  submenu[0].click?.(undefined as never, undefined as never, undefined as never)
  await Promise.resolve()

  expect(onClick).toHaveBeenCalledWith(context)
})
