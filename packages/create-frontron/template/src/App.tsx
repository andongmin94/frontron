import { useEffect, useState } from "react"

import { bridge } from "frontron/client"

import { Button } from "@/components/ui/button"
import { hasDesktopBridgeRuntime } from "@/lib/utils"

export function App() {
  const hasDesktopBridge = hasDesktopBridgeRuntime()
  const minHeightClass = hasDesktopBridge
    ? "min-h-[calc(100dvh-40px)]"
    : "min-h-dvh"
  const [runtimeInfo, setRuntimeInfo] = useState("Connecting desktop bridge...")

  useEffect(() => {
    let cancelled = false

    async function loadRuntimeInfo() {
      if (!hasDesktopBridge) {
        if (!cancelled) {
          setRuntimeInfo(
            "Web preview mode. Run `npm run app:dev` to start the desktop bridge.",
          )
        }
        return
      }

      try {
        const version = await bridge.system.getVersion()
        const platform = await bridge.system.getPlatform()

        if (!cancelled) {
          setRuntimeInfo(
            `Connected to Frontron ${String(version)} on ${String(platform)}.`,
          )
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setRuntimeInfo(`Desktop bridge error: ${message}`)
        }
      }
    }

    void loadRuntimeInfo()

    return () => {
      cancelled = true
    }
  }, [hasDesktopBridge])

  return (
    <div className={`flex ${minHeightClass} overflow-hidden p-6`}>
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Project ready!</h1>
          <p>You may now add components and start building.</p>
          <p>The component base and desktop shell are already wired.</p>
          <Button className="mt-2">Button</Button>
        </div>
        <div className="rounded-lg border border-border/70 bg-card p-4 text-card-foreground shadow-sm">
          <div className="font-medium">Desktop status</div>
          <p className="mt-2 text-muted-foreground">{runtimeInfo}</p>
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          Use <code>npm run dev</code> for web preview and{" "}
          <code>npm run app:dev</code> for desktop mode.
        </div>
      </div>
    </div>
  )
}

export default App
