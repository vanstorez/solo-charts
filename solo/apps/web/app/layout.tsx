import type { Metadata, Viewport } from "next";

import Nav from "@/components/Nav";
import { Clock, SessionPill } from "@/components/Clock";
import { DataModePill } from "@/components/DataModePill";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solo Trading Charts — Event Intelligence Terminal",
  description:
    "Local research terminal for Indian markets: provenance-aware charts, global news intelligence, Bank Nifty scenarios and event-lag research. Paper trading only.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/solo-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/solo-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/solo-icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Solo",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#070b16",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Nav />
          <div className="main-shell">
            <header className="topbar">
              <div className="topbar-left">
                <span className="live-dot" />
                <span className="topbar-title">LOCAL RESEARCH TERMINAL</span>
                <span className="topbar-divider" />
                <Clock />
              </div>
              <div className="topbar-right">
                <SessionPill />
                <DataModePill />
                <span className="paper-pill">PAPER ONLY</span>
                <span className="live-off">LIVE EXECUTION OFF</span>
              </div>
            </header>
            <main className="page">{children}</main>
            <footer className="app-footer">
              <span>Solo Trading Charts · research and paper trading only · not investment advice</span>
              <span>Provider timestamps and freshness are shown on every module.</span>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
