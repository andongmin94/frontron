// 일렉트론 모듈
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import { createSplash, closeSplash } from './splash.js'; // splash.js 임포트

// ESM에서 __dirname 사용하기 위한 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let PORT;
const isDev = process.env.NODE_ENV === 'development';
if (!isDev) {
  // 로컬 웹 서버 모듈
  const express = (await import('express')).default;
  const server = express();
  
  // 빌드 파일 서빙
  server.use(express.static(path.join(__dirname, '../../dist')));

  // 루트 경로 요청 처리
  server.get('/', (_, res) => res.sendFile(path.join(__dirname, '../../dist', 'index.html')));

  // 로컬 호스트로 연결
  const listener = server.listen(0, 'localhost', () => PORT = listener.address().port);
} else {
  const viteConfig = fs.readFileSync(path.join(__dirname, '../../vite.config.ts'), 'utf-8');
  const portMatch = viteConfig.match(/port:\s*(\d+)/);
  if (portMatch && portMatch[1]) PORT = parseInt(portMatch[1], 10);
}

// 일렉트론 생성 함수
let mainWindow;
const createWindow = () => {
  // 브라우저 창 생성
  mainWindow = new BrowserWindow({
    show: false, // 스플래시 화면이 먼저 보이도록 false로 설정
    width: 1600,
    height: 900,
    frame: false,
    resizable: isDev,
    icon: path.join(__dirname, "../../public/icon.png"),
    webPreferences: {
      nodeIntegration: true,    // Node.js API 활성화
      contextIsolation: false,  // preload 스크립트와 렌더러 프로세스 간 격리 해제
      webSecurity: false,       // 웹 보안 기능 비활성화
    },
  });

  // 포트 연결
  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.webContents.on('did-finish-load', () => {
    closeSplash(); // 스플래시 화면 닫기
    mainWindow.show(); // 메인 윈도우 표시
  });

  // 우클릭 메뉴 비활성화
  mainWindow.hookWindowMessage(278, function(e) {
    mainWindow.setEnabled(false);
    setTimeout(() => mainWindow.setEnabled(true), 100);
    return true;
  });

  // 종료 설정
  if (process.platform === 'darwin') {
    mainWindow.on('close', (e) => {
      if (!app.isQuiting) {
        e.preventDefault();
        mainWindow.hide();
        app.dock.hide();
      }
      return false;
    });
  } else {
    mainWindow.on('close', () => app.quit());
  }
};

// Electron의 초기화가 완료후 브라우저 윈도우 생성
app.whenReady().then(() => {
  createSplash(); // 스플래시 화면 생성
  createWindow(); // 메인 윈도우 생성
}).then(() => {
  // 트레이 세팅
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "../../public/icon.png")));
  tray.setToolTip("Frontron");
  tray.on("double-click", () => mainWindow.show());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "열기", type: "normal", click: () => mainWindow.show() },
      { label: "종료", type: "normal", click: () => mainWindow.close() },
    ])
  );

  // 기본 생성 세팅
  app.on("window-all-closed", () => process.platform !== "darwin" ? app.quit() : null);

  // macOS-특화 설정
  if (process.platform === 'darwin') {
    app.on('before-quit', () => tray.destroy());

    app.on('activate', () => {
      app.dock.show();
      BrowserWindow.getAllWindows().length === 0 ? createWindow() : null;
    });
  } else {
    // 모든 플랫폼에 적용되는 activate 이벤트 핸들러 (macOS 제외)
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 ? createWindow() : null);
  }

  // 타이틀 바 옵션
  ipcMain.on("hidden", () => mainWindow.hide());
  ipcMain.on("minimize", () => mainWindow.minimize());
  ipcMain.on("maximize", () => mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize());

  // F5 새로고침, F12 개발자 도구 열기
  if (isDev) {
    const menu = Menu.buildFromTemplate([{
      label: "File",
      submenu: [
        {
          label: "Reload",
          accelerator: "F5",
          click: () => mainWindow.reload(),
        },
        {
          label: "Toggle DevTools",
          accelerator: "F12",
          click: () => mainWindow.webContents.toggleDevTools(),
        },
      ],
    }]);
    Menu.setApplicationMenu(menu);
  }
});