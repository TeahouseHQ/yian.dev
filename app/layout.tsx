import { Noto_Sans } from "next/font/google";
import Script from "next/script";

import { SiteTitle, SiteDescription, IS_LOCAL_DEV, BaseUrl } from "../lib/constants";

import "../styles/index.css";

export const metadata = {
  metadataBase: new URL(BaseUrl),
  title: SiteTitle,
  description: SiteDescription,
};

const noto = Noto_Sans({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en" className={noto.className}>
      <head>
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=202403" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=202403" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?v=202403" />
        <link rel="manifest" href="/site.webmanifest?v=202403" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg?v=202403" color="#4c574a" />
        <link rel="shortcut icon" href="/favicon.ico?v=202403" />
        <meta name="msapplication-TileColor" content="#4c574a" />
        <meta name="theme-color" content="#c6ccc3" />

        {/* Theme for highlight.js */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link
          rel="stylesheet"
          href="//cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/atom-one-dark.min.css"
        />

        {!IS_LOCAL_DEV && (
          <>
            <Script async src="https://www.googletagmanager.com/gtag/js?id=G-P9MJR96YXY" />
            <Script id="ga">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());

                gtag('config', 'G-P9MJR96YXY');
              `}
            </Script>
          </>
        )}
        <Script src="https://kit.fontawesome.com/87445c11d6.js" />
        <Script src="https://cdn.jsdelivr.net/npm/@tsparticles/confetti@3.0.3/tsparticles.confetti.bundle.min.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
