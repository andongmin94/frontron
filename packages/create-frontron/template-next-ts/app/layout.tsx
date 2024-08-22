import type { Metadata, Viewport } from "next";

import TitleBar from "@/components/TitleBar";

import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Frontron",
  openGraph: { title: "Frontron" },
  icons: [
    { rel: "icon", url: "/frontron.svg" },
    { rel: "shortcut Icon", url: "/frontron.svg" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html>
      <body>
        <TitleBar />
        {children}
      </body>
    </html>
  );
}
