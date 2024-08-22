import TitleBar from "@/components/TitleBar";

import "./globals.css";

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata = {
  title: "Frontron",
  openGraph: { title: "Frontron" },
  icons: [
    { rel: "icon", url: "/frontron.svg" },
    { rel: "shortcut Icon", url: "/frontron.svg" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <TitleBar />
        {children}
      </body>
    </html>
  );
}
