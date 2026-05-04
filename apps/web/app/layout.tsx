import type { Metadata } from "next";
import { ViewStateListener } from "@/components/view-state-listener";
import { NotifyButton } from "@/components/notify-button";
import { RecentQueriesPanel } from "@/components/recent-queries-panel";
import { WorkstreamNav } from "@/components/workstream-nav";
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
        <div className="flex min-h-screen">
          <WorkstreamNav />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
        <NotifyButton />
        <RecentQueriesPanel />
      </body>
    </html>
  );
}
