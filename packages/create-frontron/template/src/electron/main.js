import path from 'path';
import { fileURLToPath } from 'url';
import { app, Menu } from 'electron'; // 필요한 모듈만 남김

// 모듈 임포트
import { createSplash, closeSplash } from './splash.js';
import { determinePort } from './serve.js';
import { createWindow, getMainWindow } from './window.js';
import { createTray, destroyTray } from './tray.js';
import { setupIpcHandlers } from './ipc.js';
import { setupDevMenu } from './dev.js';

// --- 기본 설정 ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.NODE_ENV === 'development';
let DEFAULT_PORT = 0; // 기본 포트 번호

let PORT; // 포트 번호 저장

// --- 싱글 인스턴스 보장 ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // --- 앱 초기화 및 실행 ---
  async function initializeApp() {
    try {
      PORT = await determinePort(isDev, __dirname, DEFAULT_PORT);
      if (PORT === null) {
        throw new Error('Failed to determine port.');
      }

      await app.whenReady();

      createSplash();
      createWindow(PORT, isDev, __dirname, closeSplash); // mainWindow 생성
      createTray(getMainWindow, __dirname); // 트레이 생성
      setupIpcHandlers(getMainWindow); // IPC 핸들러 설정

      if (isDev) {
        setupDevMenu(getMainWindow); // 개발 메뉴 설정
      } else {
        Menu.setApplicationMenu(null); // 프로덕션 메뉴 제거
      }

    } catch (error) {
      console.error('Failed to initialize app:', error);
      // 사용자에게 오류 알림 (예: dialog.showErrorBox)
      app.quit(); // 초기화 실패 시 앱 종료
    }
  }

  initializeApp();

  // --- 앱 생명주기 이벤트 핸들러 ---
  app.on('window-all-closed', () => {
    // macOS 제외하고 모든 창 닫히면 앱 종료
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // macOS: Dock 아이콘 클릭 시 창이 없으면 새로 생성
    const mainWindow = getMainWindow();
    if (mainWindow === null) {
      // PORT가 유효하다는 보장이 필요함. initializeApp 재실행 또는 상태 관리 필요.
      // 여기서는 간단히 initializeApp을 다시 호출하는 대신,
      // 이미 실행 중인 앱의 창을 보여주는 로직만 남기는 것이 안전할 수 있음.
      // createWindow(PORT, isDev, __dirname, closeSplash); // 재실행 시 문제 발생 가능성
      console.log('Activate event: No window found, consider re-initialization logic if needed.');
    } else {
        mainWindow.show(); // 숨겨진 창 보여주기
    }
  });

  app.on('before-quit', () => {
    // 앱 종료 전 처리 (예: 트레이 아이콘 제거)
    destroyTray();
  });

} // 싱글 인스턴스 Lock 블록 끝