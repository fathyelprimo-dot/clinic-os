import type { Metadata } from "next";
import "./globals.css";
import "./clinic.css";

export const metadata: Metadata = {
  title: "د. أحمد علي | حجز ومتابعة العيادة",
  description: "بداية تجريبية لموقع العيادة: حجز موعد ومتابعة الدور وإدارة الحجوزات باللغة العربية.",
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
