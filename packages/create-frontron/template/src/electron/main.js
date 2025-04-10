// 일렉트론 모듈
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';

// ESM에서 __dirname 사용하기 위한 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경 변수 설정
import dotenv from 'dotenv';
dotenv.config();
// package.json 파일의 절대 경로 생성
const packagePath = path.join(__dirname, '../../package.json');
// 파일 읽고 JSON으로 파싱
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const isDev = process.env.NODE_ENV === 'development';
const DEV_PORT = pkg.config.port.dev;
const PROD_PORT = pkg.config.port.prod;
let PORT = isDev ? DEV_PORT : PROD_PORT;

// 로컬 웹 서버 모듈
import express from 'express';
const server = express();

// 개발 모드가 아닐때 빌드 파일 서빙 로직
if (!isDev) {
  // 빌드 파일 서빙
  server.use(express.static(path.join(__dirname, '../../dist')));

  // 루트 경로 요청 처리
  server.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
  });

  // 서버 시작
  server.listen(PORT, 'localhost', () => {}).on('error', (err) => {
    // 포트가 이미 사용 중인 경우 다른 포트로 재시도
    if (err.code === 'EADDRINUSE') {
      PORT += 1; // 포트 번호 증가
      setTimeout(() => {
        server.listen(PORT, 'localhost');
      }, 1000); // 1초 후에 다시 시도
    }
  });
}

// 일렉트론 생성 함수
let mainWindow;
const createWindow = () => {
  // 브라우저 창 생성
  mainWindow = new BrowserWindow({
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
    mainWindow.on('close', () => {
      app.quit();
    });
  }
};

// Electron의 초기화가 완료후 브라우저 윈도우 생성
app.whenReady().then(createWindow).then(() => {
  // 기본 생성 세팅
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  // macOS-specific settings
  if (process.platform === 'darwin') {
    app.on('before-quit', () => {
      tray.destroy();
    });

    app.on('activate', () => {
      app.dock.show();
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } else {
    // 모든 플랫폼에 적용되는 activate 이벤트 핸들러 (macOS 제외)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }

  // 타이틀 바 옵션
  ipcMain.on("hidden", () => mainWindow.hide());
  ipcMain.on("minimize", () => mainWindow.minimize());
  ipcMain.on("maximize", () => {
    mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
  });

  // 트레이 세팅
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "../../public/icon.png")));
  tray.setToolTip("Frontron React");
  tray.on("double-click", () => mainWindow.show());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", type: "normal", click: () => mainWindow.show() },
      { label: "Quit", type: "normal", click: () => mainWindow.close() },
    ])
  );

  // F5 새로고침, F12 개발자 도구 열기
  if (isDev) {
    const menu = Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "Reload",
            accelerator: "F5",
            click: () => {
              mainWindow.reload();
            },
          },
          {
            label: "Toggle DevTools",
            accelerator: "F12",
            click: () => {
              mainWindow.webContents.toggleDevTools();
            },
          },
        ],
      },
    ]);
    Menu.setApplicationMenu(menu);
  }
});

export default mainWindow;