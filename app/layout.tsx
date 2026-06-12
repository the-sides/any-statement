import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Statement Ledger",
  description: "Review PDF statement expenses and sync approved items to Notion."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
