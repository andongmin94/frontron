// 일렉트론 모듈
const path = require("path");
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require("electron");
const fs = require('fs');

// package.json 파일 읽기
const templateDir = __dirname; // templateDir 경로 설정
const packageJsonPath = path.join(templateDir, '../../package.json');
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

// 환경 변수 설정
require("dotenv").config();
let PORT = process.env.NODE_ENV === 'development' ? 3000 : 1994;

// 로컬 웹 서버 모듈
const express = require('express');
const server = express();

// 개발 모드가 아닐때 빌드 파일 서빙 로직
if (process.env.NODE_ENV !== 'development') {
  // 빌드 파일 서빙
  server.use(express.static(path.join(__dirname, '../../dist')));

  // 루트 경로 요청 처리
  server.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../dist', 'index.html'));
  });

  // 서버 시작
  server.listen(PORT, () => {}).on('error', (err) => {
    // 포트가 이미 사용 중인 경우 다른 포트로 재시도
    if (err.code === 'EADDRINUSE') {
      PORT += 1; // 포트 번호 증가
      setTimeout(() => {
        server.listen(PORT);
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
    icon: path.join(__dirname, "../../public/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
  });

  // 포트 연결
  mainWindow.loadURL(`http://localhost:${PORT}`);
};

// Electron의 초기화가 완료후 브라우저 윈도우 생성
app.whenReady().then(createWindow).then(() => {
  // 기본 생성 세팅
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 타이틀 바 옵션
  ipcMain.on("hidden", () => mainWindow.hide());
  ipcMain.on("minimize", () => mainWindow.minimize());
  ipcMain.on("maximize", () => {
    mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
  });

  // 트레이 세팅
  const tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "../../public/icon.png")));
  tray.setToolTip(pkg.build.productName);
  tray.on("double-click", () => mainWindow.show());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", type: "normal", click: () => mainWindow.show() },
      { label: "Quit", type: "normal", click: () => app.quit() },
    ])
  );

  // F5 새로고침, F12 개발자 도구 열기
  if (process.env.NODE_ENV === "development") {
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