import { useState } from "react";
import frontronLogo from "/icon.png";
import viteLogo from "/vite.svg";
import reactLogo from "./assets/react.svg";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="app">
      <div>
        <img src={frontronLogo} className="logo frontron" alt="Frontron logo" />
        <img src={reactLogo} className="logo react" alt="React logo" />
        <img src={viteLogo} className="logo" alt="Vite logo" />
      </div>
      <h1>Frontron + React + Vite</h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
    </div>
  );
}

export default App;
