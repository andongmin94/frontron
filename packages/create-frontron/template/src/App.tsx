import { useEffect, useState } from "react";

import reactLogo from "./assets/react.svg";
import frontronLogo from "/logo.svg";
import viteLogo from "/vite.svg";

import "./App.css";

function App() {
  const [count, setCount] = useState(0);
  const [nodeInfo, setNodeInfo] = useState("테스트 중...");

  useEffect(() => {
    // Node.js API 접근 테스트
    try {
      // process 객체는 Node.js API의 일부입니다
      const nodeVersion = process?.versions?.node;
      const platform = process?.platform;

      setNodeInfo(
        `Node.js ${nodeVersion}가 사용 가능합니다! (플랫폼: ${platform})`,
      );
    } catch (error: any) {
      setNodeInfo(`Node.js API를 사용할 수 없습니다: ${error.message}`);
    }
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
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <div>
        <h3>Node.js API 테스트 결과:</h3>
        <p>{nodeInfo}</p>
      </div>
    </div>
  );
}

export default App;
