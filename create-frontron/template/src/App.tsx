import { useEffect, useState } from "react"

import reactLogo from "./assets/react.svg"
import viteLogo from "/vite.svg"

import DesktopSettingsDialog from "@/components/desktop/SettingsDialog"
import { Button } from "@/components/ui/button"
import { getDesktopBridgeRuntime } from "@/lib/utils"

export function App() {
  const [count, setCount] = useState(0)
  const [hasDesktopBridge, setHasDesktopBridge] = useState(false)
  const [desktopStatus, setDesktopStatus] = useState(
    "Checking desktop bridge..."
  )

  useEffect(() => {
    let cancelled = false

    async function loadDesktopStatus() {
      const desktopBridge = getDesktopBridgeRuntime()

      if (!desktopBridge) {
        if (!cancelled) {
          setDesktopStatus(
            "Web preview mode. Run `npm run app` to start Electron."
          )
        }
        return
      }

      try {
        const info = await desktopBridge.getAppInfo()

        if (!cancelled) {
          setHasDesktopBridge(true)
          setDesktopStatus(
            `${info.name} ${info.version} · ${info.platform}/${info.arch}`
          )
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setDesktopStatus(`Electron bridge error: ${message}`)
        }
      }
    }

    void loadDesktopStatus()

    return () => {
      cancelled = true
    }
  }, [])

  async function openTextFile() {
    const file = await getDesktopBridgeRuntime()?.openTextFile({
      title: "Open a text file",
    })

    if (file) {
      setDesktopStatus(
        `Opened ${file.name} (${file.content.length.toLocaleString()} characters)`
      )
    }
  }

  async function saveTextFile() {
    const result = await getDesktopBridgeRuntime()?.saveTextFile({
      title: "Save a text file",
      defaultPath: "frontron-note.txt",
      content: `Frontron native bridge ready.\nCount: ${count}\n`,
    })

    if (result) {
      setDesktopStatus(`Saved ${result.path}`)
    }
  }

  async function copyStatus() {
    const bridge = getDesktopBridgeRuntime()
    if (!bridge) return

    await bridge.writeClipboardText(desktopStatus)
    setDesktopStatus("Desktop status copied to the clipboard.")
  }

  async function showNotification() {
    const shown = await getDesktopBridgeRuntime()?.showNotification({
      title: "Frontron",
      body: "The native notification bridge is ready.",
    })

    setDesktopStatus(
      shown
        ? "Native notification sent."
        : "Native notifications are not supported on this system."
    )
  }

  return (
    <>
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden px-6 py-10 text-center">
        <div className="flex items-center gap-6">
          <img src={viteLogo} className="size-18" alt="Vite logo" />
          <img src={reactLogo} className="size-18" alt="React logo" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Electron template ready</h1>
          <p className="text-sm text-muted-foreground">
            Edit <code>src/App.tsx</code> and <code>src/electron/ipc.ts</code>{" "}
            to start building your app.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button type="button" onClick={() => setCount((value) => value + 1)}>
            Count is {count}
          </Button>
          <Button type="button" disabled={!hasDesktopBridge} onClick={openTextFile}>
            Open text file
          </Button>
          <Button type="button" disabled={!hasDesktopBridge} onClick={saveTextFile}>
            Save text file
          </Button>
          <Button type="button" disabled={!hasDesktopBridge} onClick={copyStatus}>
            Copy status
          </Button>
          <Button type="button" disabled={!hasDesktopBridge} onClick={showNotification}>
            Notify
          </Button>
        </div>
        <div className="max-w-xl rounded-lg border border-border/70 bg-card p-4 text-sm text-card-foreground shadow-sm">
          <div className="font-medium">Desktop status</div>
          <p className="mt-2 break-words text-muted-foreground">
            {desktopStatus}
          </p>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          Use <code>npm run dev</code> for web preview and{" "}
          <code>npm run app</code> for Electron mode.
        </div>
      </div>

      <DesktopSettingsDialog />
    </>
  )
}

export default App
