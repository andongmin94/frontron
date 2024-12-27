import fs from "node:fs";
import net from "node:net";

export function getPortFromViteConfig(viteConfigPath: string): number | null {
  if (!fs.existsSync(viteConfigPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(viteConfigPath, "utf8");
    const serverBlockMatch = content.match(/server\s*:\s*\{([\s\S]*?)\}/m);
    if (!serverBlockMatch?.[1]) {
      return null;
    }

    const portMatch = serverBlockMatch[1].match(/port\s*:\s*(\d+)/);
    if (!portMatch?.[1]) {
      return null;
    }
    return Number.parseInt(portMatch[1], 10);
  } catch {
    return null;
  }
}

function isPortOpen(
  port: number,
  host: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
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
  options: {
    host?: string;
    timeoutMs?: number;
    intervalMs?: number;
    probeTimeoutMs?: number;
  } = {},
) {
  const {
    host = "127.0.0.1",
    timeoutMs = 30_000,
    intervalMs = 250,
    probeTimeoutMs = 1000,
  } = options;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port, host, probeTimeoutMs)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for dev server on http://${host}:${port}`);
}
