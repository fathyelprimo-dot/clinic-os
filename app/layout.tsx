import type { Metadata } from "next";
import "./globals.css";
import "./clinic.css";

export const metadata: Metadata = {
  title: "Clinic OS | لوحة مالك المنصة",
  description: "إدارة العيادات والاشتراكات وروابط الأطباء من لوحة المالك في Clinic OS.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
