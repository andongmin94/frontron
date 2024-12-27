import { Tray, App, BrowserWindow } from 'electron';

interface TrayOptions {
    app: App;
    window: BrowserWindow;
    iconPath: string;
    tooltip?: string;
    openLabel?: string;
    quitLabel?: string;
}
interface TrayController {
    tray: Tray | null;
    destroy(): void;
}

declare function createTrayController(options: TrayOptions): TrayController;

export { createTrayController };
export type { TrayController, TrayOptions };
