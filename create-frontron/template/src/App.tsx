import { useEffect, useState } from "react"
import { BellIcon, FileTextIcon, SaveIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function App() {
  const bridge = window.electron
  const [status, setStatus] = useState(
    bridge
      ? "Connecting to the Electron main process..."
      : "Browser preview. Run `npm run app` to launch Electron."
  )

  useEffect(() => {
    if (!bridge) return

    let cancelled = false

    void bridge
      .getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setStatus(
            `${info.name} ${info.version} · ${info.platform}/${info.arch}`
          )
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          setStatus(`Electron bridge error: ${message}`)
        }
      })

    return () => {
      cancelled = true
    }
  }, [bridge])

  async function openTextFile() {
    const file = await bridge?.openTextFile({ title: "Open a text file" })

    if (file) {
      setStatus(
        `Opened ${file.name} · ${file.content.length.toLocaleString()} characters`
      )
    }
  }

  async function saveTextFile() {
    const result = await bridge?.saveTextFile({
      title: "Save a text file",
      defaultPath: "frontron-note.txt",
      content: "Frontron desktop app ready.\n",
    })

    if (result) {
      setStatus(`Saved ${result.path}`)
    }
  }

  async function showNotification() {
    const shown = await bridge?.showNotification({
      title: "Frontron",
      body: "The native bridge is ready.",
    })

    setStatus(shown ? "Notification sent." : "Notifications are unavailable.")
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <Badge variant="secondary">Electron + React + Vite + shadcn/ui</Badge>
          <CardTitle>
            <h1 className="text-2xl font-semibold">Desktop app ready</h1>
          </CardTitle>
          <CardDescription>
            Edit <code>src/App.tsx</code> for the interface and{" "}
            <code>src/electron/ipc.ts</code> for native features. Every
            shadcn/ui component is in <code>src/components/ui</code>.
          </CardDescription>
        </CardHeader>
        <CardContent
          className="flex flex-wrap gap-2"
          aria-label="Native bridge examples"
        >
          <Button disabled={!bridge} onClick={openTextFile}>
            <FileTextIcon />
            Open text file
          </Button>
          <Button variant="outline" disabled={!bridge} onClick={saveTextFile}>
            <SaveIcon />
            Save text file
          </Button>
          <Button
            variant="outline"
            disabled={!bridge}
            onClick={showNotification}
          >
            <BellIcon />
            Notify
          </Button>
        </CardContent>
        <CardFooter>
          <p
            className="status text-sm text-muted-foreground"
            aria-live="polite"
          >
            {status}
          </p>
        </CardFooter>
      </Card>
    </main>
  )
}

export default App
