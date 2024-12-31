import { BrowserWindow } from 'electron';
import { C as CreateMainWindowOptions, R as RegisterWindowIpcHandlersOptions } from '../shared/frontron.BNEkugTn.mjs';
export { W as WindowIpcChannels, a as WindowLoadTarget, b as WindowStatePayload } from '../shared/frontron.BNEkugTn.mjs';

declare function createMainWindow(options: CreateMainWindowOptions): BrowserWindow;
declare function registerWindowControlIpcHandlers(options: RegisterWindowIpcHandlersOptions): () => void;

export { CreateMainWindowOptions, RegisterWindowIpcHandlersOptions, createMainWindow, registerWindowControlIpcHandlers };
