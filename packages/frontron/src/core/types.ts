export type FrontronListener = (...args: unknown[]) => void;

export interface FrontronBridge {
  send(channel: string, payload?: unknown): void;
  invoke<TResult = unknown>(channel: string, payload?: unknown): Promise<TResult>;
  on(channel: string, listener: FrontronListener): () => void;
  removeListener(channel: string, listener: FrontronListener): void;
}

export interface ExposeBridgeOptions {
  globalKey?: string;
  sendChannels?: readonly string[];
  invokeChannels?: readonly string[];
  onChannels?: readonly string[];
  allowUnsafeChannels?: boolean;
}
