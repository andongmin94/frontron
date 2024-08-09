import { Inter } from "next/font/google";
import TitleBar from "@/components/TitleBar";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const viewport = {
  width: 'device-width',
  initialScale: 1
};

export const metadata = {
  title: "Frontron",
  openGraph: { title:"Frontron" },
  icons: [
    { rel: "icon", url: "/icon.png" },
    { rel: "shortcut Icon", url: "/icon.png" }
  ]
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TitleBar />
        {children}
      </body>
    </html>
  );
}
