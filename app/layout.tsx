import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// Names and headings: lettering with the feel of shop signage
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
});

// Everything else: designed by the Braille Institute for low-vision readers
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Local Map",
  description:
    "Find independent small businesses in DC, Maryland and Virginia, by congressional district. Data from OpenStreetMap.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${atkinson.variable}`}>
      <body>{children}</body>
    </html>
  );
}
