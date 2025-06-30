import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "@/globals.css";

//////////////// electron components ////////////////
import TitleBar from "@/components/TitleBar";
const { ipcRenderer } = require("electron");
/////////////////////////////////////////////////////

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <TitleBar ipcRenderer={ipcRenderer} />
    <App ipcRenderer={ipcRenderer} />
  </>
);
