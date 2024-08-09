import type { Viewport, Metadata } from "next";
import { Inter } from "next/font/google";
import TitleBar from "@/components/TitleBar";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
}

export const metadata: Metadata = {
  title: "Frontron",
  openGraph: { title:"Frontron" },
  icons: [
    { rel: "icon", url: "/icon.png" },
    { rel: "shortcut Icon", url: "/icon.png" }
  ]
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TitleBar />
        {children}
      </body>
    </html>
  );
}
