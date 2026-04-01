import { useEffect, useState } from "react"

import reactLogo from "./assets/react.svg"
import viteLogo from "/vite.svg"

import { Button } from "@/components/ui/button"
import DesktopSettingsDialog from "@/components/desktop/SettingsDialog"
import { useCloseButtonBehavior } from "@/lib/desktop-settings"
import { getDesktopBridgeRuntime } from "@/lib/utils"

export function App() {
  const [hasDesktopBridge, setHasDesktopBridge] = useState(false)
  const minHeightClass = hasDesktopBridge
    ? "min-h-[calc(100dvh-40px)]"
    : "min-h-dvh"
  const [count, setCount] = useState(0)
  const [bridgeState, setBridgeState] = useState("Checking desktop bridge...")
  const [closeButtonBehavior] = useCloseButtonBehavior()

  useEffect(() => {
    let cancelled = false

    async function loadBridgeState() {
      const desktopBridge = getDesktopBridgeRuntime()

      if (!desktopBridge) {
        if (!cancelled) {
          setHasDesktopBridge(false)
          setBridgeState(
            "Web preview mode. Run `npm run app` to start Electron."
          )
        }
        return
      }

      try {
        const state = await desktopBridge.getWindowState()

        if (!cancelled) {
          setHasDesktopBridge(true)
          setBridgeState(
            `Electron bridge ready. maximized=${Boolean(state?.isMaximized)} minimized=${Boolean(state?.isMinimized)}`
          )
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setBridgeState(`Electron bridge error: ${message}`)
        }
      }
    }

    void loadBridgeState()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <div
        className={`flex ${minHeightClass} flex-col items-center justify-center gap-6 overflow-hidden px-6 py-10 text-center`}
      >
        <div className="flex items-center gap-6">
          <img src={viteLogo} className="size-18" alt="Vite logo" />
          <img src={reactLogo} className="size-18" alt="React logo" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Electron template ready</h1>
          <p className="text-sm text-muted-foreground">
            Edit <code>src/App.tsx</code> and <code>src/electron/main.ts</code>{" "}
            to start building your app.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" onClick={() => setCount((value) => value + 1)}>
            Count is {count}
          </Button>
        </div>
        <div className="max-w-md rounded-lg border border-border/70 bg-card p-4 text-sm text-card-foreground shadow-sm">
          <div className="font-medium">Desktop status</div>
          <p className="mt-2 text-muted-foreground">{bridgeState}</p>
          {hasDesktopBridge ? (
            <p className="mt-3 text-xs text-muted-foreground">
              X button behavior:{" "}
              <span className="font-medium text-foreground">
                {closeButtonBehavior === "quit" ? "Quit app" : "Tray minimize"}
              </span>
            </p>
          ) : null}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          Use <code>npm run dev</code> for web preview and{" "}
          <code>npm run app</code> for Electron mode.
        </div>
      </div>

      {hasDesktopBridge ? <DesktopSettingsDialog /> : null}
    </>
  )
}

export default App
