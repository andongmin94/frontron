import fs from "fs";
import path from "path";

import { app } from "electron";

const isDev = process.env.NODE_ENV === "development";

function publicBaseCandidates(): string[] {
  if (isDev) {
    return [path.join(process.cwd(), "public")];
  }

  return [
    path.join(process.resourcesPath, "public"),
    path.join(app.getAppPath(), "public"),
    path.join(process.cwd(), "public"),
  ];
}

export function resolvePublicPath(...segments: string[]): string {
  for (const base of publicBaseCandidates()) {
    const candidate = path.join(base, ...segments);
    if (fs.existsSync(candidate)) return candidate;
  }

  return path.join(publicBaseCandidates()[0], ...segments);
}
