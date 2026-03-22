import { useEffect, useState } from "react";

import { bridge } from "frontron/client";

import reactLogo from "./assets/react.svg";
import frontronLogo from "/logo.svg";
import viteLogo from "/vite.svg";

import { hasDesktopBridgeRuntime } from "@/lib/utils";

import "./App.css";

function App() {
  const [count, setCount] = useState(0);
  const [runtimeInfo, setRuntimeInfo] = useState("브리지 연결 확인 중...");
  const [appBridgeInfo, setAppBridgeInfo] = useState("app bridge 확인 중...");
  const [nativeInfo, setNativeInfo] = useState("native bridge 확인 중...");

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeInfo() {
      if (!hasDesktopBridgeRuntime()) {
        if (!cancelled) {
          setRuntimeInfo(
            "Web preview mode. Run `npm run app:dev` to start the desktop bridge.",
          );
          setAppBridgeInfo("App bridge is available only in desktop mode.");
          setNativeInfo("Native bridge is available only in desktop mode.");
        }
        return;
      }

      try {
        const version = await bridge.system.getVersion();
        const platform = await bridge.system.getPlatform();
        const nativeStatus = await bridge.native.getStatus();
        const nativeMessage = nativeStatus.ready
          ? `Native runtime 준비 완료: cpu=${String(await bridge.system.cpuCount())} add=${String(await bridge.math.add(2, 3))} average=${String(await bridge.math.average(2, 3))} health=${String(await bridge.health.isReady())} file=${String(await bridge.file.hasTxtExtension("notes.txt"))}`
          : `Native runtime 비활성 또는 미준비 상태입니다. enabled=${String(nativeStatus.enabled)} loaded=${String(nativeStatus.loaded)}`;

        if (!cancelled) {
          setRuntimeInfo(
            `Frontron runtime ${String(version)}가 연결되었습니다. (플랫폼: ${String(platform)})`,
          );
          setNativeInfo(nativeMessage);

          const greeting = await bridge.app.getGreeting();
          const summary = await bridge.app.getSummary();

          if (!cancelled) {
            setAppBridgeInfo(
              `${String(greeting)} mode=${String((summary as { mode?: unknown }).mode)} layer=${String((summary as { layer?: unknown }).layer)}`,
            );
          }
        }
      } catch (error: any) {
        if (!cancelled) {
          setRuntimeInfo(`Desktop bridge error: ${error.message}`);
          setAppBridgeInfo(`App bridge error: ${error.message}`);
          setNativeInfo(`Native bridge error: ${error.message}`);
        }
      }
    }

    void loadRuntimeInfo();

    return () => {
      cancelled = true;
    };
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
        <button onClick={() => setCount((current) => current + 1)}>
          count is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <div>
        <h3>Runtime bridge 상태:</h3>
        <p>{runtimeInfo}</p>
      </div>
      <div>
        <h3>App bridge 상태:</h3>
        <p>{appBridgeInfo}</p>
      </div>
      <div>
        <h3>Native bridge 상태:</h3>
        <p>{nativeInfo}</p>
      </div>
    </div>
  );
}

export default App;
