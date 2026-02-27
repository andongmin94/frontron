import { App, BrowserWindow } from 'electron';
import { a as WindowLoadTarget, C as CreateMainWindowOptions } from '../shared/frontron.BNEkugTn.js';

declare function getPortFromViteConfig(viteConfigPath: string): number | null;
declare function waitForPortReady(port: number, options?: {
    host?: string;
    timeoutMs?: number;
    intervalMs?: number;
    probeTimeoutMs?: number;
}): Promise<void>;

interface SplashOptions {
    width?: number;
    height?: number;
    message?: string;
    fontPath?: string;
    backgroundColor?: string;
    spinnerColor?: string;
    textColor?: string;
}
interface TrayRuntimeOptions {
    enabled?: boolean;
    iconPath?: string;
    tooltip?: string;
    openLabel?: string;
    quitLabel?: string;
}
interface StartFrontronAppOptions {
    appName?: string;
    isDev?: boolean;
    rendererDistPath: string;
    preloadPath: string;
    iconPath?: string;
    viteConfigPath?: string;
    devServerPort?: number;
    devServerHost?: string;
    waitForDevServer?: boolean;
    resolveDevServerPort?: (context: Pick<FrontronAppContext, "app" | "isDev">) => number | Promise<number>;
    resolveRendererLoadTarget?: (context: {
        app: App;
        isDev: boolean;
        devServerPort: number | null;
        devServerHost: string;
        rendererDistPath: string;
    }) => WindowLoadTarget | Promise<WindowLoadTarget>;
    includeLegacyWindowChannels?: boolean;
    splash?: false | SplashOptions;
    tray?: false | TrayRuntimeOptions;
    window?: Partial<Omit<CreateMainWindowOptions, "isDev" | "preloadPath" | "iconPath" | "rendererDistPath" | "devServerHost" | "devServerPort">>;
    onReady?: (context: FrontronAppContext) => void | Promise<void>;
    onAfterIpcSetup?: ((context: FrontronAppContext) => void | (() => void)) | ((context: FrontronAppContext) => Promise<void | (() => void)>);
}
interface FrontronAppContext {
    app: App;
    isDev: boolean;
    devServerPort: number | null;
    mainWindow: BrowserWindow;
}
interface FrontronAppHandle {
    started: boolean;
    reason?: "single-instance-locked";
}

declare function startFrontronApp(options: StartFrontronAppOptions): Promise<FrontronAppHandle>;

declare function createSplashWindow(options?: SplashOptions): BrowserWindow;
declare function closeSplashWindow(splashWindow: BrowserWindow | null): void;

export { closeSplashWindow, createSplashWindow, getPortFromViteConfig, startFrontronApp, waitForPortReady };
export type { FrontronAppContext, FrontronAppHandle, SplashOptions, StartFrontronAppOptions, TrayRuntimeOptions };
