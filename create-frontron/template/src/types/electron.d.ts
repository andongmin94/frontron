export {}

type ElectronAppInfo = {
  name: string
  version: string
  platform: string
  arch: string
}

type ElectronTextFile = {
  path: string
  name: string
  content: string
}

type ElectronOpenTextFileOptions = {
  title?: string
  extensions?: string[]
}

type ElectronSaveTextFileOptions = {
  title?: string
  defaultPath?: string
  content: string
}

type ElectronNotificationOptions = {
  title: string
  body?: string
}

declare global {
  interface Window {
    electron?: {
      getAppInfo: () => Promise<ElectronAppInfo>
      openTextFile: (
        options?: ElectronOpenTextFileOptions
      ) => Promise<ElectronTextFile | null>
      saveTextFile: (
        options: ElectronSaveTextFileOptions
      ) => Promise<{ path: string } | null>
      readClipboardText: () => Promise<string>
      writeClipboardText: (text: string) => Promise<void>
      showNotification: (
        options: ElectronNotificationOptions
      ) => Promise<boolean>
    }
  }
}
