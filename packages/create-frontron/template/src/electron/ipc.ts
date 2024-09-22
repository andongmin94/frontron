import { ipcMain } from 'electron';

/**
 * 개발 환경용 메뉴 설정
 * @param {Function} getMainWindow - 메인 윈도우 객체를 반환하는 함수
 */
interface MainWindowGetter {
  (): Electron.BrowserWindow | null; // 메인 윈도우 객체를 반환하는 함수
}
export function setupIpcHandlers(getMainWindow: MainWindowGetter) {
  ipcMain.on('hidden', () => {
    getMainWindow()?.hide();
  });

  ipcMain.on('minimize', () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on('maximize', () => {
    const mw = getMainWindow();
    if (mw && mw.isMinimized()) {
      mw.restore();
    } else {
      mw?.maximize();
    }
  });

  // 여기에 다른 IPC 핸들러 추가 가능
}