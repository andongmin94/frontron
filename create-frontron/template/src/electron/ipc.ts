import { basename } from "node:path"
import { readFile, stat, writeFile } from "node:fs/promises"
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron"

import { mainWindow } from "./window.js"

const getAppInfoChannel = "app:get-info"
const openTextFileChannel = "file:open-text"
const saveTextFileChannel = "file:save-text"
const readClipboardTextChannel = "clipboard:read-text"
const writeClipboardTextChannel = "clipboard:write-text"
const showNotificationChannel = "notification:show"

const maximumTextFileBytes = 16 * 1024 * 1024
const maximumClipboardCharacters = 1_000_000
const maximumNotificationCharacters = 4_000
const defaultTextExtensions = [
  "txt",
  "md",
  "json",
  "csv",
  "log",
  "yaml",
  "yml",
  "xml",
]

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readOptionalString(
  value: unknown,
  label: string,
  maximumLength: number
) {
  if (typeof value === "undefined") return undefined
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`)
  }

  const normalized = value.trim()
  if (normalized.length > maximumLength) {
    throw new Error(`${label} is too long.`)
  }

  return normalized || undefined
}

function readRequiredString(
  value: unknown,
  label: string,
  maximumLength: number
) {
  const result = readOptionalString(value, label, maximumLength)

  if (!result) {
    throw new Error(`${label} is required.`)
  }

  return result
}

function readTextExtensions(value: unknown) {
  if (typeof value === "undefined") return defaultTextExtensions
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error("extensions must be a non-empty array with at most 20 entries.")
  }

  const extensions = value.map((entry) => {
    if (typeof entry !== "string" || !/^[a-z0-9]+$/i.test(entry)) {
      throw new Error("Each extension must contain only letters and numbers.")
    }

    return entry.toLowerCase()
  })

  return [...new Set(extensions)]
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow
) {
  if (event.sender !== window.webContents) {
    throw new Error("Rejected IPC request from an untrusted renderer.")
  }
}

async function readSelectedTextFile(filePath: string) {
  const fileStats = await stat(filePath)

  if (!fileStats.isFile()) {
    throw new Error("The selected path is not a regular file.")
  }

  if (fileStats.size > maximumTextFileBytes) {
    throw new Error("The selected text file is larger than 16 MiB.")
  }

  return {
    path: filePath,
    name: basename(filePath),
    content: await readFile(filePath, "utf8"),
  }
}

export function setupIpcHandlers() {
  const window = mainWindow

  if (!window) return

  for (const channel of [
    getAppInfoChannel,
    openTextFileChannel,
    saveTextFileChannel,
    readClipboardTextChannel,
    writeClipboardTextChannel,
    showNotificationChannel,
  ]) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(getAppInfoChannel, (event) => {
    assertTrustedSender(event, window)

    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    }
  })

  ipcMain.handle(openTextFileChannel, async (event, value: unknown) => {
    assertTrustedSender(event, window)
    const options = readRecord(value)
    const result = await dialog.showOpenDialog(window, {
      title: readOptionalString(options.title, "title", 200),
      properties: ["openFile"],
      filters: [
        {
          name: "Text files",
          extensions: readTextExtensions(options.extensions),
        },
      ],
    })

    if (result.canceled || !result.filePaths[0]) return null
    return await readSelectedTextFile(result.filePaths[0])
  })

  ipcMain.handle(saveTextFileChannel, async (event, value: unknown) => {
    assertTrustedSender(event, window)
    const options = readRecord(value)
    const content = readRequiredString(
      options.content,
      "content",
      maximumTextFileBytes
    )
    const result = await dialog.showSaveDialog(window, {
      title: readOptionalString(options.title, "title", 200),
      defaultPath: readOptionalString(
        options.defaultPath,
        "defaultPath",
        4_096
      ),
    })

    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, content, "utf8")
    return { path: result.filePath }
  })

  ipcMain.handle(readClipboardTextChannel, (event) => {
    assertTrustedSender(event, window)
    return clipboard.readText()
  })

  ipcMain.handle(writeClipboardTextChannel, (event, value: unknown) => {
    assertTrustedSender(event, window)
    const text = readRequiredString(
      value,
      "clipboard text",
      maximumClipboardCharacters
    )
    clipboard.writeText(text)
  })

  ipcMain.handle(showNotificationChannel, (event, value: unknown) => {
    assertTrustedSender(event, window)
    const options = readRecord(value)
    const title = readRequiredString(
      options.title,
      "notification title",
      200
    )
    const body = readOptionalString(
      options.body,
      "notification body",
      maximumNotificationCharacters
    )

    if (!Notification.isSupported()) return false
    new Notification({ title, body }).show()
    return true
  })
}
