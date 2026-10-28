import type { Metadata } from "next";
import { Proza_Libre, Public_Sans } from "next/font/google";
import "./globals.css";

const bodyFont = Public_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

// Dutch humanist sans (Bureau Roffa) for headings.
const headingFont = Proza_Libre({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Stapp", template: "%s · Stapp" },
  description: "Overzichtelijke bedrijfsadministratie.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={`${bodyFont.variable} ${headingFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
