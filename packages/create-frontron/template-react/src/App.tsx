import { useEffect, useState } from "react";

import reactLogo from "./assets/react.svg";
import frontronLogo from "/logo.svg";
import viteLogo from "/vite.svg";

import "./App.css";

function App() {
  const [count, setCount] = useState(0);
  const [runtimeInfo, setRuntimeInfo] = useState("Detecting runtime...");

  useEffect(() => {
    if (typeof window !== "undefined" && window.electron) {
      setRuntimeInfo("Frontron preload bridge is connected.");
    } else {
      setRuntimeInfo("Running as a pure web renderer (no preload bridge).");
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
        <button onClick={() => setCount((previous) => previous + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR.
        </p>
      </div>
      <div>
        <h3>Runtime Check:</h3>
        <p>{runtimeInfo}</p>
      </div>
    </div>
  );
}

export default App;