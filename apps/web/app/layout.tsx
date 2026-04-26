import type { Metadata } from "next";
import { ViewStateListener } from "@/components/view-state-listener";
import { NotifyButton } from "@/components/notify-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crux",
  description: "Inspect Crux workstreams",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground">
        <ViewStateListener />
        {children}
        <NotifyButton />
      </body>
    </html>
  );
}
