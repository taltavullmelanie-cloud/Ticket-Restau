import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tickets Restau Hub",
  description: "Application de gestion des Tickets Restaurant",
  icons: {
    icon: "/icon.png",        // PNG 512x512 dans /public
    shortcut: "/favicon.ico", // Favicon .ico dans /public
    apple: "/icon.png",       // iOS / PWA
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        {/* Optionnel : forcer explicitement les liens si cache pénible */}
        <link rel="icon" href="/favicon.ico?v=2" />
        <link rel="apple-touch-icon" href="/icon.png?v=2" />
      </head>
      <body>{children}</body>
    </html>
  );
}
