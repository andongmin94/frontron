import { useEffect, useState } from "react";

import reactLogo from "./assets/react.svg";
import frontronLogo from "/logo.svg";
import viteLogo from "/vite.svg";

import "./App.css";

type WindowState = {
  isMaximized: boolean;
  isMinimized: boolean;
};

function App() {
  const [windowState, setWindowState] = useState("창 상태를 불러오는 중...");

  const refreshWindowState = async () => {
    const electronApi = window.electron;
    if (!electronApi?.invoke) {
      setWindowState("Electron 브리지를 사용할 수 없습니다.");
      return;
    }

    try {
      const state = await electronApi.invoke<WindowState>("get-window-state");

      setWindowState(
        state.isMaximized
          ? "현재 창은 최대화 상태입니다."
          : state.isMinimized
            ? "현재 창은 최소화 상태입니다."
            : "현재 창은 일반 상태입니다.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "알 수 없는 오류";
      setWindowState(`창 상태를 불러오지 못했습니다: ${message}`);
    }
  };

  useEffect(() => {
    void refreshWindowState();
  }, []);

  return (
    <div className="app">
      <div>
        <img src={frontronLogo} className="logo frontron" alt="Frontron logo" />
        <img src={reactLogo} className="logo react" alt="React logo" />
        <img src={viteLogo} className="logo" alt="Vite logo" />
      </div>
      <h1>Frontron</h1>
      <div className="card">
        <button onClick={() => void refreshWindowState()}>
          창 상태 다시 확인하기
        </button>
        <p>
          Electron 기능은 <code>window.electron</code> 브리지를 통해 호출합니다.
        </p>
      </div>
      <div>
        <h3>창 상태 확인 결과:</h3>
        <p>{windowState}</p>
      </div>
    </div>
  );
}

export default App;
