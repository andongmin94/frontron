import { BrowserWindow } from 'electron';
import { C as CreateMainWindowOptions, R as RegisterWindowIpcHandlersOptions } from '../shared/frontron.C2m6cApQ.js';
export { W as WindowIpcChannels, a as WindowStatePayload } from '../shared/frontron.C2m6cApQ.js';

declare function createMainWindow(options: CreateMainWindowOptions): BrowserWindow;
declare function registerWindowControlIpcHandlers(options: RegisterWindowIpcHandlersOptions): () => void;

export { CreateMainWindowOptions, RegisterWindowIpcHandlersOptions, createMainWindow, registerWindowControlIpcHandlers };
