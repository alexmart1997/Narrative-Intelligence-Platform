import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Narrative Intelligence",
  description: "Локальный инструмент для анализа статей, похожих материалов, графов связей и сравнения освещения."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
