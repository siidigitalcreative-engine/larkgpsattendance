import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Attendance Check-In",
  description: "GPS-restricted attendance check-in for Lark external groups",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
