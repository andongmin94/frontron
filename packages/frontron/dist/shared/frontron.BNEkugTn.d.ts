import { BrowserWindow, IpcMain } from 'electron';

type WindowLoadTarget = {
    kind: "url";
    value: string;
} | {
    kind: "file";
    value: string;
};
interface CreateMainWindowOptions {
    isDev: boolean;
    preloadPath: string;
    iconPath?: string;
    rendererDistPath?: string;
    devServerHost?: string;
    devServerPort?: number;
    width?: number;
    height?: number;
    frame?: boolean;
    showOnReady?: boolean;
    resizableInDev?: boolean;
    disableContextMenu?: boolean;
    hideOnCloseForMac?: boolean;
    loadTarget?: WindowLoadTarget;
    onDidFinishLoad?: (window: BrowserWindow) => void;
}
interface WindowIpcChannels {
    hide: string;
    minimize: string;
    toggleMaximize: string;
    state: string;
    maximizedChanged: string;
}
interface RegisterWindowIpcHandlersOptions {
    window: BrowserWindow;
    ipcMainInstance?: IpcMain;
    channels?: Partial<WindowIpcChannels>;
    includeLegacyChannels?: boolean;
}
interface WindowStatePayload {
    isMaximized: boolean;
    isMinimized: boolean;
}

export type { CreateMainWindowOptions as C, RegisterWindowIpcHandlersOptions as R, WindowIpcChannels as W, WindowLoadTarget as a, WindowStatePayload as b };
