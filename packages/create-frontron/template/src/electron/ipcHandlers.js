import { ipcMain } from 'electron';

/**
 * IPC 이벤트 핸들러 설정
 * @param {Function} getMainWindow - 메인 윈도우 객체를 반환하는 함수
 */
export function setupIpcHandlers(getMainWindow) {
  ipcMain.on('hidden', () => {
    getMainWindow()?.hide();
  });

  ipcMain.on('minimize', () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on('maximize', () => {
    const mw = getMainWindow();
    if (mw) {
      mw.isMaximized() ? mw.restore() : mw.maximize();
    }
  });

  // 여기에 다른 IPC 핸들러 추가 가능
}