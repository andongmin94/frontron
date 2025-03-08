import type { FrontronDesktopContext, ResolvedFrontronSecurityConfig } from '../types'

type SecurityAwareWebContents = {
  getURL(): string
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'allow' | 'deny' }): void
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void
}

function readUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isInternalNavigationTarget(targetUrl: string, currentUrl: string) {
  const target = readUrl(targetUrl)
  const current = readUrl(currentUrl)

  if (!target || !current) {
    return true
  }

  if (target.protocol === 'about:') {
    return true
  }

  return target.origin === current.origin
}

export function readSecurityNavigationAction(
  targetUrl: string,
  currentUrl: string,
  policy: ResolvedFrontronSecurityConfig['externalNavigation'],
) {
  if (isInternalNavigationTarget(targetUrl, currentUrl)) {
    return 'allow' as const
  }

  return policy
}

export function applyConfiguredSecurityPolicy(
  webContents: SecurityAwareWebContents,
  shell: FrontronDesktopContext['shell'],
  security: ResolvedFrontronSecurityConfig | undefined,
) {
  if (!security) {
    return
  }

  webContents.setWindowOpenHandler(({ url }) => {
    const action = readSecurityNavigationAction(url, webContents.getURL(), security.newWindow)

    if (action === 'allow') {
      return { action: 'allow' }
    }

    if (action === 'openExternal') {
      void shell.openExternal({ url })
    }

    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event, url) => {
    const action = readSecurityNavigationAction(url, webContents.getURL(), security.externalNavigation)

    if (action === 'allow') {
      return
    }

    event.preventDefault()

    if (action === 'openExternal') {
      void shell.openExternal({ url })
    }
  })
}
