import fs from "fs";
import net from "net";
import path from "path";

import { __dirname, isDev } from "./main.js";

function getPortFromViteConfig(configPath: string) {
  try {
    if (!fs.existsSync(configPath)) {
      console.log(`Vite config not found at ${configPath}, using default port.`);
      return null;
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    const portMatch = configContent.match(/server\s*:\s*\{([\s\S]*?)\}/);

    if (portMatch?.[1]) {
      const serverBlockContent = portMatch[1];
      const portLineMatch = serverBlockContent.match(/port\s*:\s*(\d+)/);

      if (portLineMatch?.[1]) {
        const port = parseInt(portLineMatch[1], 10);
        console.log(`Found port ${port}.`);
        return port;
      }
    }

    console.log(
      `Port configuration not found in ${configPath}, using default port.`,
    );
    return null;
  } catch (error) {
    console.error(`Error reading or parsing ${configPath}:`, error);
    return null;
  }
}

function isPortOpen(port: number, host = "127.0.0.1", timeoutMs = 1000) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function waitForPortReady(
  port: number,
  timeoutMs = 30_000,
  intervalMs = 250,
) {
  // 변경: Vite 포트가 실제로 열릴 때까지 polling 대기
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for dev server on http://localhost:${port}`);
}

export async function determinePort() {
  if (!isDev) {
    try {
      const express = (await import("express")).default;
      const server = express();
      const distPath = path.join(__dirname, "../../dist");

      if (!fs.existsSync(distPath)) {
        throw new Error(`Distribution directory not found: ${distPath}`);
      }

      server.use(express.static(distPath));
      server.get("/", (_, res) => {
        const indexPath = path.join(distPath, "index.html");
        if (fs.existsSync(indexPath)) res.sendFile(indexPath);
        else res.status(404).send("index.html not found");
      });

      return new Promise<number | null>((resolve, reject) => {
        const listener = server.listen(0, "localhost", () => {
          const address = listener.address();
          const port =
            typeof address === "object" && address !== null ? address.port : null;
          console.log(`Production server listening on port ${port}`);
          resolve(port);
        });

        listener.on("error", (err) => {
          console.error("Failed to start production server:", err);
          reject(err);
        });
      });
    } catch (error) {
      console.error("Error setting up production server:", error);
      return null;
    }
  }

  const viteConfigPath = path.join(__dirname, "../../vite.config.ts");
  const vitePort = getPortFromViteConfig(viteConfigPath);
  // 변경: 포트 미설정 시 localhost:0으로 열리지 않도록 기본값 3000 사용
  const portToUse = vitePort ?? 3000;
  console.log(`Using development port: ${portToUse}`);
  return portToUse;
}
