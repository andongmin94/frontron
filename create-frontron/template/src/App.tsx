import { useEffect, useState } from "react"

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
          setStatus(`${info.name} ${info.version} · ${info.platform}/${info.arch}`)
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
      setStatus(`Opened ${file.name} · ${file.content.length.toLocaleString()} characters`)
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
    <main className="app-shell">
      <section className="app-card">
        <p className="eyebrow">Electron + React + Vite</p>
        <h1>Desktop app ready</h1>
        <p className="intro">
          Edit <code>src/App.tsx</code> for the interface and{" "}
          <code>src/electron/ipc.ts</code> for native features.
        </p>

        <div className="actions" aria-label="Native bridge examples">
          <button type="button" disabled={!bridge} onClick={openTextFile}>
            Open text file
          </button>
          <button type="button" disabled={!bridge} onClick={saveTextFile}>
            Save text file
          </button>
          <button type="button" disabled={!bridge} onClick={showNotification}>
            Notify
          </button>
        </div>

        <p className="status" aria-live="polite">
          {status}
        </p>
      </section>
    </main>
  )
}

export default App
