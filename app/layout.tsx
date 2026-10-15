import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

// The US government's civic typeface (U.S. Web Design System): plain, legible, public-service
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Local Map",
  description:
    "Find independent small businesses around Washington, DC. Map data from OpenStreetMap and Organic Maps.",
};

// Set the theme before the first paint, so dark mode doesn't flash light (see hooks/useTheme.ts)
const THEME_SCRIPT = `try{var c=localStorage.getItem("local-map:theme:v1");var d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set before React loads, so React must not complain that it differs
    <html lang="en" className={publicSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
