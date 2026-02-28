import fs from "fs";
import { pathToFileURL } from "url";

import { BrowserWindow } from "electron";

import { resolvePublicPath } from "./paths.js";

let splashWindow: BrowserWindow | null = null;

export function createSplash() {
  const fontPath = resolvePublicPath("fonts", "PretendardVariable.woff2");
  const fontSrcUrl = pathToFileURL(fontPath).toString();
  const hasFont = fs.existsSync(fontPath);

  splashWindow = new BrowserWindow({
    width: 300,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    transparent: false,
    skipTaskbar: true,
  });

  const fontFaceCss = hasFont
    ? `
      @font-face {
        font-family: 'Pretendard';
        src: url('${fontSrcUrl}') format('woff2');
        font-weight: 400;
        font-style: normal;
      }
    `
    : "";

  const htmlContent = `
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Loading...</title>
        <style>
          ${fontFaceCss}

          body {
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
            font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Segoe UI', sans-serif;
            user-select: none;
          }

          .spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border-left-color: #09f;
            animation: spin 1s ease-in-out infinite;
            margin-top: 30px;
            margin-bottom: 10px;
          }

          .loading-text {
            color: #333;
            font-size: 20px;
          }

          .dots::after {
            content: '.';
            animation: dots 1.5s steps(3, end) infinite;
            display: inline-block;
            width: 1.5em;
            text-align: left;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          @keyframes dots {
            0% { content: '.'; }
            35% { content: '..'; }
            70% { content: '...'; }
          }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="loading-text">
          <h3>Loading <span class="dots"></span></h3>
        </div>
      </body>
    </html>
  `;

  splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
  );

  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  return splashWindow;
}

export function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
  }

  splashWindow = null;
}
