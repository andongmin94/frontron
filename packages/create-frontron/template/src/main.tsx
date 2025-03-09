import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import TitleBar from "@/components/TitleBar.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="desktop-template-theme">
      <TitleBar />
      <App />
    </ThemeProvider>
  </StrictMode>
)
