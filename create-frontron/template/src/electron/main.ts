import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { app, Menu, net, protocol } from "electron"

import { setupDevMenu } from "./dev.js"
import { setupIpcHandlers } from "./ipc.js"
import {
  inferDevUrl,
  startRendererServer,
  stopRendererServer,
  waitForUrlReady,
} from "./serve.js"
import { closeSplash, createSplash } from "./splash.js"
import { createTray, destroyTray } from "./tray.js"
import { createWindow, mainWindow } from "./window.js"

export const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const isDev = process.env.NODE_ENV === "development"
export let isQuitting = false
const rendererScheme = "frontron"
export const rendererOrigin = `${rendererScheme}://app`
const defaultRendererCsp =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererScheme,
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
])

// resolveRendererProxyUrl 함수는 custom protocol 요청을 내부 렌더러 서버 URL로 바꾼다.
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

// rewriteRendererLocation 함수는 내부 서버 redirect가 안정적인 렌더러 origin을 유지하게 한다.
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

// ensureRendererCsp 함수는 앱이 CSP를 제공하지 않았을 때만 Electron용 기본 정책을 추가한다.
function ensureRendererCsp(headers: Headers) {
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", defaultRendererCsp)
  }
}

// rewriteRendererRequestHeaders 함수는 custom origin을 내부 서버가 기대하는 loopback origin으로 바꾼다.
function rewriteRendererRequestHeaders(request: Request, targetOrigin: string) {
  const headers = new Headers(request.headers)

  if (headers.get("origin") === rendererOrigin) {
    headers.set("origin", targetOrigin)
  }

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

// registerRendererProtocol 함수는 production 렌더러 요청을 내부 HTTP 서버로 프록시한다.
export async function registerRendererProtocol(rendererTargetUrl: string) {
  const targetOrigin = new URL(rendererTargetUrl).origin

  await protocol.handle(rendererScheme, async (request) => {
    const proxyUrl = resolveRendererProxyUrl(request.url, targetOrigin)

    if (!proxyUrl) {
      return new Response("Not Found", { status: 404 })
    }

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

// runRendererProbe 함수는 release smoke에서 실제 렌더러와 preload 상태를 기록하고 앱을 종료한다.
function runRendererProbe() {
  const outputPath = process.env.FRONTRON_RENDERER_PROBE_PATH?.trim()

  if (!outputPath || !mainWindow) return

  const capture = async () => {
    try {
      const result = await mainWindow?.webContents.executeJavaScript(
        `({
          protocol: window.location.protocol,
          origin: window.location.origin,
          title: document.title,
          bodyText: document.body?.innerText ?? "",
          bridgeType: typeof window.electron,
        })`,
        true
      )

      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(
        outputPath,
        `${JSON.stringify({ ok: true, ...result }, null, 2)}\n`,
        "utf8"
      )
      app.exit(0)
    } catch (error) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
      fs.writeFileSync(
        outputPath,
        `${JSON.stringify({ ok: false, error: String(error) }, null, 2)}\n`,
        "utf8"
      )
      app.exit(1)
    }
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => void capture())
  } else {
    void capture()
  }
}

// initializeApp 함수는 Electron 앱과 렌더러 런타임을 준비한다.
async function initializeApp() {
  await app.whenReady()
  createSplash()

  let rendererUrl: string

  if (isDev) {
    rendererUrl =
      process.env.ELECTRON_RENDERER_URL?.trim() || (await inferDevUrl())
    rendererUrl = await waitForUrlReady(rendererUrl)
  } else {
    const rendererTargetUrl = await startRendererServer()
    await registerRendererProtocol(rendererTargetUrl)
    rendererUrl = `${rendererOrigin}/`
  }

  createWindow(rendererUrl)
  runRendererProbe()
  await createTray()
  setupIpcHandlers()

  if (isDev) setupDevMenu()
  else Menu.setApplicationMenu(null)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  initializeApp().catch(async (error) => {
    console.error("Failed to initialize app:", error)
    closeSplash()
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
    if (mainWindow) {
      mainWindow.show()
    }
  })

  app.on("before-quit", () => {
    isQuitting = true
    destroyTray()
    void stopRendererServer().catch((error: unknown) => {
      console.error("Failed to stop renderer server:", error)
    })
  })
}
