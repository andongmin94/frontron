import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, Menu, net, protocol } from "electron"

import { setupDevMenu } from "./dev.js"
import { setupIpcHandlers } from "./ipc.js"
import { startRendererServer, stopRendererServer } from "./serve.js"
import { createWindow, mainWindow } from "./window.js"

export const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const isDev = process.env.NODE_ENV === "development"
const rendererScheme = "frontron"
export const rendererOrigin = `${rendererScheme}://app`
const defaultRendererCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
let rendererUrl: string | null = null
let rendererShutdownPromise: Promise<void> | null = null
let rendererShutdownComplete = false

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
])

function resolveRendererProxyUrl(requestUrl: string, targetOrigin: string) {
  const rendererRequestUrl = new URL(requestUrl)
  if (
    rendererRequestUrl.protocol !== `${rendererScheme}:` ||
    rendererRequestUrl.host !== "app"
  ) {
    return null
  }

  const proxyUrl = new URL(targetOrigin)
  proxyUrl.pathname = rendererRequestUrl.pathname
  proxyUrl.search = rendererRequestUrl.search
  return proxyUrl
}

function rewriteRendererLocation(
  headers: Headers,
  proxyUrl: URL,
  targetOrigin: string
) {
  const location = headers.get("location")
  if (!location) return

  try {
    const redirectUrl = new URL(location, proxyUrl)
    if (redirectUrl.origin === targetOrigin) {
      headers.set(
        "location",
        `${rendererOrigin}${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`
      )
    }
  } catch {
    headers.delete("location")
  }
}

function ensureRendererCsp(headers: Headers) {
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", defaultRendererCsp)
  }
}

function rewriteRendererRequestHeaders(request: Request, targetOrigin: string) {
  const headers = new Headers(request.headers)
  if (headers.get("origin") === rendererOrigin) headers.set("origin", targetOrigin)

  const referer = headers.get("referer")
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      if (
        refererUrl.protocol === `${rendererScheme}:` &&
        refererUrl.host === "app"
      ) {
        headers.set(
          "referer",
          `${targetOrigin}${refererUrl.pathname}${refererUrl.search}${refererUrl.hash}`
        )
      }
    } catch {
      headers.delete("referer")
    }
  }

  return headers
}

export async function registerRendererProtocol(rendererTargetUrl: string) {
  const targetOrigin = new URL(rendererTargetUrl).origin

  await protocol.handle(rendererScheme, async (request) => {
    const proxyUrl = resolveRendererProxyUrl(request.url, targetOrigin)
    if (!proxyUrl) return new Response("Not Found", { status: 404 })

    try {
      const upstreamResponse = await net.fetch(proxyUrl.toString(), {
        method: request.method,
        headers: rewriteRendererRequestHeaders(request, targetOrigin),
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : request.body,
        redirect: "manual",
        signal: request.signal,
      })
      const responseHeaders = new Headers(upstreamResponse.headers)
      rewriteRendererLocation(responseHeaders, proxyUrl, targetOrigin)
      ensureRendererCsp(responseHeaders)
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    } catch (error) {
      console.error("Failed to proxy renderer request:", error)
      return new Response("Bad Gateway", { status: 502 })
    }
  })
}

function openMainWindow() {
  if (!rendererUrl) return
  createWindow(rendererUrl, setupIpcHandlers)
}

async function initializeApp() {
  await app.whenReady()

  if (isDev) {
    const developmentUrl = process.env.ELECTRON_RENDERER_URL?.trim()
    if (!developmentUrl) {
      throw new Error(
        "ELECTRON_RENDERER_URL is required in development. Start the app with the generated app script."
      )
    }
    rendererUrl = developmentUrl
  } else {
    const rendererTargetUrl = await startRendererServer()
    await registerRendererProtocol(rendererTargetUrl)
    rendererUrl = `${rendererOrigin}/`
  }

  openMainWindow()
  if (isDev) setupDevMenu()
  else Menu.setApplicationMenu(null)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  initializeApp().catch(async (error) => {
    console.error("Failed to initialize app:", error)
    await stopRendererServer().catch(() => {})
    const { dialog } = await import("electron")
    dialog.showErrorBox(
      "Error",
      `Failed to initialize app:\n${(error as Error).message}`
    )
    app.quit()
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })

  app.on("activate", () => {
    if (mainWindow) mainWindow.show()
    else openMainWindow()
  })

  app.on("before-quit", (event) => {
    if (rendererShutdownComplete) return

    event.preventDefault()
    if (rendererShutdownPromise) return

    rendererShutdownPromise = stopRendererServer()
      .catch((error: unknown) => {
        console.error("Failed to stop renderer server:", error)
      })
      .finally(() => {
        rendererShutdownComplete = true
        app.quit()
      })
  })
}
