import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  startStaticRendererServer,
  stopStaticRendererServer,
} from "./static-server.js"

const runtimeDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(runtimeDir, "../..")
const require = createRequire(import.meta.url)
const electronExecutablePath = require("electron") as string
const { ELECTRON_RUN_AS_NODE: _ignoredElectronRunAsNode, ...childEnv } =
  process.env

let viteDevServer: import("vite").ViteDevServer | null = null
let electronProcess: ChildProcess | null = null
let closeElectronWatcher: (() => void) | null = null
let shutdownPromise: Promise<void> | null = null
let restartPromise: Promise<void> = Promise.resolve()
let restartQueued = false
let shuttingDown = false

function resolveDevRendererUrl(server: import("vite").ViteDevServer) {
  const localUrl =
    server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network?.[0]

  if (localUrl) return localUrl

  const address = server.httpServer?.address()
  if (typeof address === "object" && address !== null) {
    return `http://localhost:${address.port}`
  }

  throw new Error("Failed to resolve the Vite dev server URL.")
}

async function stopElectronProcess() {
  const child = electronProcess
  electronProcess = null

  if (!child || child.exitCode !== null || child.signalCode !== null) return

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceKillTimer)
      clearTimeout(abandonTimer)
      resolve()
    }
    const forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL")
    }, 5_000)
    const abandonTimer = setTimeout(finish, 7_000)

    child.once("exit", finish)

    try {
      if (!child.kill("SIGTERM")) finish()
    } catch {
      finish()
    }
  })
}

function spawnElectronProcess(rendererUrl: string) {
  if (shuttingDown) return

  const child = spawn(electronExecutablePath, ["."], {
    cwd: rootDir,
    stdio: "inherit",
    env: {
      ...childEnv,
      NODE_ENV: "development",
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  })
  electronProcess = child

  child.once("error", (error) => {
    if (electronProcess !== child || shuttingDown) return
    electronProcess = null
    console.error("[template] Failed to start Electron.", error)
    void shutdownDevLauncher(1)
  })

  child.once("exit", (code, signal) => {
    if (electronProcess !== child) return
    electronProcess = null
    if (shuttingDown) return

    if (signal) {
      console.error(`[template] Electron exited after ${signal}.`)
      void shutdownDevLauncher(1)
      return
    }

    void shutdownDevLauncher(code ?? 0)
  })
}

function queueElectronRestart(rendererUrl: string) {
  if (shuttingDown || restartQueued) return
  restartQueued = true

  restartPromise = restartPromise
    .then(async () => {
      restartQueued = false
      if (shuttingDown) return
      await stopElectronProcess()
      spawnElectronProcess(rendererUrl)
    })
    .catch((error) => {
      restartQueued = false
      console.error("[template] Failed to restart Electron.", error)
      void shutdownDevLauncher(1)
    })
}

async function shutdownDevLauncher(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise

  shuttingDown = true
  shutdownPromise = (async () => {
    closeElectronWatcher?.()
    closeElectronWatcher = null
    await stopElectronProcess()

    if (viteDevServer) {
      await viteDevServer.close().catch((error) => {
        console.error("[template] Failed to close the Vite dev server.", error)
      })
      viteDevServer = null
    }

    process.exit(exitCode)
  })()

  return shutdownPromise
}

async function watchElectronSources(rendererUrl: string) {
  const ts = await import("typescript")
  const configPath = path.join(rootDir, "tsconfig.electron.json")
  const formatHost: import("typescript").FormatDiagnosticsHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
  }
  const reportDiagnostic = (diagnostic: import("typescript").Diagnostic) => {
    console.error(ts.formatDiagnostic(diagnostic, formatHost))
  }
  const reportWatchStatusChanged = (
    diagnostic: import("typescript").Diagnostic
  ) => {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      ts.sys.newLine
    )

    if (!message.includes("Found 0 errors")) {
      console.log(`[template] ${message}`)
    }
  }
  const host = ts.createWatchCompilerHost(
    configPath,
    {},
    ts.sys,
    ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    reportDiagnostic,
    reportWatchStatusChanged
  )
  const afterProgramCreate = host.afterProgramCreate

  host.afterProgramCreate = (builderProgram) => {
    afterProgramCreate?.(builderProgram)

    if (ts.getPreEmitDiagnostics(builderProgram.getProgram()).length === 0) {
      queueElectronRestart(rendererUrl)
    }
  }

  const watcher = ts.createWatchProgram(host)
  closeElectronWatcher = () => watcher.close()
}

export async function runDevApp() {
  if (!fs.existsSync(electronExecutablePath)) {
    throw new Error(`Electron executable not found at ${electronExecutablePath}.`)
  }

  const { createServer } = await import("vite")
  viteDevServer = await createServer({
    root: rootDir,
    configFile: path.join(rootDir, "vite.config.ts"),
    clearScreen: false,
  })
  await viteDevServer.listen()
  viteDevServer.printUrls()

  const rendererUrl = resolveDevRendererUrl(viteDevServer)
  await watchElectronSources(rendererUrl)
}

export async function startRendererServer() {
  return startStaticRendererServer(path.resolve(runtimeDir, "../../dist"))
}

export async function stopRendererServer() {
  await stopStaticRendererServer()
}

if (process.argv.includes("--dev-app")) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      void shutdownDevLauncher(0)
    })
  }

  void runDevApp().catch((error) => {
    console.error("[template] Failed to start the development app.", error)
    void shutdownDevLauncher(1)
  })
}
