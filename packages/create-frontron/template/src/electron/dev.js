import { Menu } from 'electron';

/**
 * 개발 환경용 메뉴 설정
 * @param {Function} getMainWindow - 메인 윈도우 객체를 반환하는 함수
 */
export function setupDevMenu(getMainWindow) {
  const mainWindow = getMainWindow();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Developer',
      submenu: [
        { label: 'Reload', accelerator: 'F5', click: () => mainWindow?.reload() },
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}