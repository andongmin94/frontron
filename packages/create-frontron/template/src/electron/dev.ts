import { Menu } from 'electron';

/**
 * 개발 환경용 메뉴 설정
 * @param {Function} getMainWindow - 메인 윈도우 객체를 반환하는 함수
 */
interface MainWindowGetter {
  (): Electron.BrowserWindow | null; // 메인 윈도우 객체를 반환하는 함수
}
export function setupDevMenu(getMainWindow: MainWindowGetter) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Developer',
      submenu: [
        { label: 'Reload', accelerator: 'F5', click: () => getMainWindow()?.reload() },
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => getMainWindow()?.webContents.toggleDevTools() },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}