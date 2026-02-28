import path from "path";
import http from "http";

import { app } from "electron";

import { __dirname, isDev } from "./main.js"; // isDev를 main.ts에서 가져옴

let nextHttpServer: http.Server | null = null;
let nextHttpPort: number | null = null;

function parsePort(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || Number.isNaN(port)) return null;
  if (port < 1 || port > 65535) return null;
  return port;
}

// Chromium/Electron에서 차단(unsafe)되는 대표 포트들
function isUnsafePort(port: number): boolean {
  if (port === 0) return true;
  const blocked = new Set([1, 7, 9, 21, 22, 23, 25, 110, 143, 2049, 3659, 4045, 6000]);
  if (blocked.has(port)) return true;
  if (port >= 6665 && port <= 6669) return true;
  return false;
}

export async function determinePort() {
  if (!isDev) {
    try {
      if (nextHttpPort !== null) return nextHttpPort;

      // Next({ dir })에는 `.next` 폴더가 아니라 "Next 앱 루트"(package.json/app/next.config가 있는 폴더)를 전달해야 합니다.
      // 패키징(app.asar) 환경에서도 안전하게 동작하도록 Electron의 app.getAppPath()를 사용합니다.
      const appDir = app.getAppPath();

      const next = (await import("next")).default;
      const nextApp = next({ dev: false, dir: appDir });
      const handle = nextApp.getRequestHandler();

      await nextApp.prepare();

      nextHttpServer = http.createServer((req, res) => {
        handle(req, res);
      });

      return await new Promise<number>((resolve, reject) => {
        nextHttpServer!.once("error", (err) => {
          console.error("Failed to start Next production server:", err);
          reject(err);
        });

        nextHttpServer!.listen(0, "127.0.0.1", () => {
          const address = nextHttpServer!.address();
          const port =
            typeof address === "object" && address !== null
              ? address.port
              : null;
          if (typeof port !== "number") {
            reject(new Error("Failed to determine Next production server port."));
            return;
          }
          nextHttpPort = port;
          console.log(`Next production server listening on port ${port}`);
          resolve(port);
        });
      });
    } catch (error) {
      console.error("Error setting up production server:", error);
      // throw error; // 오류를 다시 던져서 initializeApp에서 잡도록 함
      return null; // 또는 null 반환 유지 (initializeApp에서 null 체크 필요)
    }
  } else {
    // --- 개발 로직 수정 ---
    const envPort =
      parsePort(process.env.NEXT_PORT) ??
      parsePort(process.env.PORT);

    const candidate = envPort ?? 3000;
    const portToUse = isUnsafePort(candidate) ? 3000 : candidate;

    console.log(`Using development port: ${portToUse}`);
    return portToUse; // 개발 모드에서는 Promise가 아닌 숫자 바로 반환
  }
}

export function stopInternalServer() {
  if (nextHttpServer) {
    try {
      nextHttpServer.close();
    } catch {
      // ignore
    }
  }
  nextHttpServer = null;
  nextHttpPort = null;
}
