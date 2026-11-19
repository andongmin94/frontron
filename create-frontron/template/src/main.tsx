import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App.tsx"
import "./index.css"

// shadcn/ui의 dark 변형은 .dark 클래스를 기준으로 하므로 운영체제 색상 모드를 따라 맞춘다.
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)")
const syncColorScheme = () => {
  document.documentElement.classList.toggle("dark", darkScheme.matches)
}
syncColorScheme()
darkScheme.addEventListener("change", syncColorScheme)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
