import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Statement Ledger",
  description: "Review PDF statement expenses and sync approved items to Notion.",
  formatDetection: {
    telephone: false,
    date: false,
    email: false,
    address: false,
    url: false
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
