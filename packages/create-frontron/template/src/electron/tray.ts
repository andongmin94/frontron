import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

let tray: Tray | null;

interface MainWindowGetter {
  (): Electron.BrowserWindow | null; // 메인 윈도우 객체를 반환하는 함수
}
export function createTray(getMainWindow: MainWindowGetter, __dirname: string) {
  const mainWindow = getMainWindow();
  if (tray || !mainWindow) return; // 중복 생성 방지 및 mainWindow 확인

  try {
    const iconPath = path.join(__dirname, '../../public/icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
        console.error('Failed to load tray icon:', iconPath);
        return;
    }
    tray = new Tray(icon);
    tray.setToolTip('Frontron');

    tray.on('double-click', () => {
      mainWindow?.show();
    });

    const contextMenu = Menu.buildFromTemplate([
      { label: '열기', type: 'normal', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: '종료',
        type: 'normal',
        click: () => {
          app.quit(); // 앱 종료 요청 (before-quit 이벤트 트리거)
        },
      },
    ]);
    tray.setContextMenu(contextMenu);

  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

/**
 * 트레이 아이콘 제거
 */
export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}