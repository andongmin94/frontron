import { BrowserWindow } from 'electron';
import path from 'path';

let mainWindow = null;

/**
 * 메인 윈도우 생성 및 설정
 * @param {number} port - 사용할 포트 번호
 * @param {boolean} isDev - 개발 모드 여부
 * @param {string} __dirname - 현재 디렉토리 경로
 * @param {Function} closeSplash - 스플래시 창 닫기 함수
 */
export function createWindow(port, isDev, __dirname, closeSplash) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1600,
    height: 900,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, '../../public/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      // preload: path.join(__dirname, 'preload.js'), // preload 사용 시 주석 해제
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.webContents.on('did-finish-load', () => {
    closeSplash(); // 스플래시 닫기
    mainWindow.show();
  });

  // --- 플랫폼별 우클릭 메뉴 비활성화 시도 ---
  if (process.platform === 'win32') {
    mainWindow.hookWindowMessage(278, function(e) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setEnabled(false);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setEnabled(true);
          }
        }, 100);
      }
      return true;
    });
  } else {
    mainWindow.webContents.on('context-menu', (event) => {
      console.log('Main process context-menu event triggered on macOS/Linux');
      event.preventDefault();
    });
  }

  // 창 닫기 이벤트 처리
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      // macOS: 사용자가 명시적으로 종료(Cmd+Q 등)하지 않으면 숨김
      if (!app.isQuiting) { // app 객체 접근 필요 시 main.js에서 전달받거나 import 필요
        e.preventDefault();
        mainWindow.hide();
        app.dock?.hide(); // Dock 에서도 숨김
      }
    }
    // 다른 OS 에서는 window-all-closed 에서 앱 종료 처리
  });

  mainWindow.on('closed', () => {
    mainWindow = null; // 창 참조 제거
  });

  return mainWindow; // 생성된 윈도우 객체 반환 (선택적)
}

/**
 * 현재 메인 윈도우 객체를 반환합니다.
 * @returns {BrowserWindow | null}
 */
export function getMainWindow() {
  return mainWindow;
}