// 일렉트론 모듈
const path = require("node:path");
const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
} = require("electron");

// 환경 변수 설정
require("dotenv").config();

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

  // 브라우저 연결
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
};

// Electron의 초기화가 완료후 브라우저 윈도우 생성
app
  .whenReady()
  .then(createWindow)
  .then(() => {
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
    const tray = new Tray(
      nativeImage.createFromPath(path.join(__dirname, "../../public/icon.png")),
    );
    tray.setToolTip("React Electron Boilerplate");
    tray.on("double-click", () => mainWindow.show());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open", type: "normal", click: () => mainWindow.show() },
        { label: "Quit", type: "normal", click: () => app.quit() },
      ]),
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
