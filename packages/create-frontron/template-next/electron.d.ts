import type { FrontronBridge } from "frontron/core";

declare global {
  interface Window {
    electron: FrontronBridge;
  }

  const electron: FrontronBridge;
}

export {};