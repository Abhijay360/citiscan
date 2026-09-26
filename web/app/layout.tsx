import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "Predicts whether a Citi Bike dock will be open when you arrive, not just right now.";

export const metadata: Metadata = {
  metadataBase: new URL("https://citiscan.vercel.app"),
  title: "CitiScan: will there be a dock when you get there?",
  description,
  openGraph: { title: "CitiScan", description, url: "/", siteName: "CitiScan", type: "website" },
  twitter: { card: "summary_large_image", title: "CitiScan", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
