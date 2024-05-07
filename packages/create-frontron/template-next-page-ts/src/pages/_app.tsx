import "@/styles/globals.css";
import type { AppProps } from "next/app";
import Head from "next/head";
import TitleBar from "@/components/TitleBar";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Frontron</title>
        <meta property="og:title" content="Frontron" key="title" />
        <link rel="icon" type="image" href="/icon.png" />
        <link rel="shortcut icon" href="/icon.png" />
      </Head>
      <TitleBar />
      <Component {...pageProps} />
    </>
  );
}
