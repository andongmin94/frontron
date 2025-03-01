import ReactDOM from "react-dom/client";

import App from "./App.tsx";

import "@/index.css";
import TitleBar from "@/components/TitleBar";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
    <TitleBar />
    <App />
  </>,
);
