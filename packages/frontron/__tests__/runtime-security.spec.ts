import { expect, test, vi } from 'vitest'

import { applyConfiguredSecurityPolicy, readSecurityNavigationAction } from '../src/runtime/security'

test('readSecurityNavigationAction keeps same-origin navigation allowed', () => {
  expect(
    readSecurityNavigationAction(
      'http://127.0.0.1:3000/settings',
      'http://127.0.0.1:3000/',
      'deny',
    ),
  ).toBe('allow')
})

test('readSecurityNavigationAction applies policy to external navigation', () => {
  expect(
    readSecurityNavigationAction(
      'https://example.com/docs',
      'http://127.0.0.1:3000/',
      'openExternal',
    ),
  ).toBe('openExternal')
})

test('applyConfiguredSecurityPolicy opens external URLs in the browser and blocks the in-app navigation', async () => {
  const openExternal = vi.fn(async () => {})
  let openHandler:
    | ((details: { url: string }) => {
        action: 'allow' | 'deny'
      })
    | undefined
  let navigateHandler:
    | ((event: { preventDefault(): void }, url: string) => void)
    | undefined

  const webContents = {
    getURL() {
      return 'http://127.0.0.1:3000/'
    },
    setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }) {
      openHandler = handler
    },
    on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void) {
      if (event === 'will-navigate') {
        navigateHandler = listener
      }
    },
  }

  applyConfiguredSecurityPolicy(
    webContents,
    {
      openExternal,
    },
    {
      externalNavigation: 'openExternal',
      newWindow: 'deny',
    },
  )

  expect(openHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })

  const preventDefault = vi.fn()
  navigateHandler?.({ preventDefault }, 'https://example.com/guide')
  await Promise.resolve()

  expect(preventDefault).toHaveBeenCalled()
  expect(openExternal).toHaveBeenCalledWith({ url: 'https://example.com/guide' })
})
