declare const WINDOW_CHANNELS: {
    readonly hide: "window:hide";
    readonly minimize: "window:minimize";
    readonly toggleMaximize: "window:toggle-maximize";
    readonly state: "window:state";
    readonly maximizedChanged: "window:maximized-changed";
};
declare const LEGACY_WINDOW_CHANNELS: {
    readonly hide: "hidden";
    readonly minimize: "minimize";
    readonly toggleMaximize: "toggle-maximize";
    readonly state: "get-window-state";
    readonly maximizedChanged: "window-maximized-changed";
};
declare const DEFAULT_SEND_CHANNELS: readonly ["window:hide", "window:minimize", "window:toggle-maximize", "hidden", "minimize", "toggle-maximize"];
declare const DEFAULT_INVOKE_CHANNELS: readonly ["window:state", "get-window-state"];
declare const DEFAULT_ON_CHANNELS: readonly ["window:maximized-changed", "window-maximized-changed"];

type FrontronListener = (...args: unknown[]) => void;
interface FrontronBridge {
    send(channel: string, payload?: unknown): void;
    invoke<TResult = unknown>(channel: string, payload?: unknown): Promise<TResult>;
    on(channel: string, listener: FrontronListener): () => void;
    removeListener(channel: string, listener: FrontronListener): void;
}
interface ExposeBridgeOptions {
    globalKey?: string;
    sendChannels?: readonly string[];
    invokeChannels?: readonly string[];
    onChannels?: readonly string[];
    allowUnsafeChannels?: boolean;
}

declare function createFrontronBridge(options?: ExposeBridgeOptions): FrontronBridge;
declare function exposeFrontronBridge(options?: ExposeBridgeOptions): void;

export { DEFAULT_INVOKE_CHANNELS, DEFAULT_ON_CHANNELS, DEFAULT_SEND_CHANNELS, LEGACY_WINDOW_CHANNELS, WINDOW_CHANNELS, createFrontronBridge, exposeFrontronBridge };
export type { ExposeBridgeOptions, FrontronBridge, FrontronListener };
