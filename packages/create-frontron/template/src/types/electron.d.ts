export {}

type DesktopWindowState = {
  isMaximized: boolean
  isMinimized: boolean
}

declare global {
  interface Window {
    electron?: {
      hideWindow: () => void
      minimizeWindow: () => void
      toggleMaximizeWindow: () => void
      quitApp: () => void
      getWindowState: () => Promise<DesktopWindowState>
      onWindowMaximizedChanged: (
        listener: (isMaximized: boolean) => void
      ) => () => void
    }
  }
}
