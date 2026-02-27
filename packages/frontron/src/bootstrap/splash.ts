import path from "node:path";

import { BrowserWindow } from "electron";

import type { SplashOptions } from "./types";

function toFileUrl(filePath: string) {
  return `file://${filePath.replace(/\\/g, "/")}`;
}

export function createSplashWindow(options: SplashOptions = {}) {
  const {
    width = 360,
    height = 220,
    message = "Loading",
    fontPath,
    backgroundColor = "#0d1117",
    spinnerColor = "#60a5fa",
    textColor = "#e5e7eb",
  } = options;

  const splashWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    transparent: false,
  });

  const fontFaceRule = fontPath
    ? `
        @font-face {
          font-family: "FrontronSans";
          src: url("${toFileUrl(path.resolve(fontPath))}") format("woff2");
          font-weight: 400;
          font-style: normal;
        }
      `
    : "";

  const html = `
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Loading...</title>
        <style>
          ${fontFaceRule}
          :root {
            color-scheme: dark;
          }
          body {
            margin: 0;
            height: 100vh;
            display: grid;
            place-items: center;
            background: ${backgroundColor};
            color: ${textColor};
            font-family: "FrontronSans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .stack {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .spinner {
            width: 34px;
            height: 34px;
            border-radius: 999px;
            border: 4px solid rgba(255, 255, 255, 0.16);
            border-left-color: ${spinnerColor};
            animation: spin 1s linear infinite;
          }
          .message {
            font-size: 16px;
            letter-spacing: 0.02em;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="stack">
          <div class="spinner"></div>
          <div class="message">${message}</div>
        </div>
      </body>
    </html>
  `;

  void splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  splashWindow.on("closed", () => {
    // no-op, only for lifecycle parity
  });

  return splashWindow;
}

export function closeSplashWindow(splashWindow: BrowserWindow | null) {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  splashWindow.destroy();
}
