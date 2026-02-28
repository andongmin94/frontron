import path from "path";
import { fileURLToPath } from "url";
import { app, Menu } from "electron";

import { setupDevMenu } from "./dev.js";
import { setupIpcHandlers } from "./ipc.js";
import { determinePort, stopInternalServer } from "./serve.js";
import { closeSplash, createSplash } from "./splash.js";
import { createTray, destroyTray } from "./tray.js";
import { createWindow, mainWindow } from "./window.js";

// --- 기본 설정 ---
export const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const isDev = process.env.NODE_ENV === "development";

// --- 싱글 인스턴스 보장 ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // 두 번째 인스턴스가 실행될 때의 동작 정의
    console.log("Second instance launched:", {
      event,
      commandLine,
      workingDirectory,
    });
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // --- 앱 초기화 및 실행 (IIFE 사용) ---
  (async () => {
    // async IIFE 시작
    try {
      await app.whenReady();
      createSplash();
      setTimeout(async () => {
        try {
          // determinePort와 createWindow는 setTimeout 콜백 안에서 실행
          const port = (await determinePort()) ?? 3000; // 기본 포트 3000 설정
          if (port === null || typeof port !== "number") {
            throw new Error(
              "Failed to determine a valid port inside setTimeout.",
            );
          }
          createWindow(port); // mainWindow 생성
          createTray(); // 트레이 생성
          setupIpcHandlers(); // IPC 핸들러 설정
        } catch (error) {
          console.error("Error creating window after delay:", error);
          // 지연 후 창 생성 실패 시 처리 (예: 오류 메시지, 앱 종료)
          closeSplash(); // 스플래시 닫기
          const { dialog } = await import("electron");
          if (dialog)
            dialog.showErrorBox(
              "Error",
              `Failed to create main window:\n${(error as Error).message}`,
            );
          app.quit();
        }
      }, 2000);

      if (isDev) setupDevMenu(); // 개발 메뉴 설정
      else Menu.setApplicationMenu(null); // 프로덕션 메뉴 제거
    } catch (error) {
      console.error("Failed to initialize app:", error);
      // 사용자에게 오류 알림 (예: dialog.showErrorBox)
      app.quit(); // 초기화 실패 시 앱 종료
    }
  })(); // async IIFE 즉시 호출

  // --- 앱 생명주기 이벤트 핸들러 ---
  app.on("window-all-closed", () => {
    // macOS 제외하고 모든 창 닫히면 앱 종료
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    // macOS: Dock 아이콘 클릭 시 창이 없으면 새로 생성
    if (mainWindow === null) {
      // PORT가 유효하다는 보장이 필요함. initializeApp 재실행 또는 상태 관리 필요.
      // 여기서는 간단히 initializeApp을 다시 호출하는 대신,
      // 이미 실행 중인 앱의 창을 보여주는 로직만 남기는 것이 안전할 수 있음.
      // createWindow(PORT, isDev, __dirname, closeSplash); // 재실행 시 문제 발생 가능성
      console.log(
        "Activate event: No window found, consider re-initialization logic if needed.",
      );
    } else {
      mainWindow.show(); // 숨겨진 창 보여주기
    }
  });

  app.on("before-quit", () => {
    // 앱 종료 전 처리 (예: 트레이 아이콘 제거)
    destroyTray();
    stopInternalServer();
  });
}
// 싱글 인스턴스 Lock 블록 끝
