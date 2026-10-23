import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { SourceViewer } from "@/components/SourceViewer";
import { WorkspaceNavigationRail } from "@/components/WorkspaceNavigationRail";
import { UsageTracker } from "@/components/UsageTracker";
import { getCurrentAppSession, isAppAuthEnabled, sessionHasAdminRole } from "@/lib/auth.server";

export const metadata: Metadata = {
  title: "IonicLink — Ionic Liquid Data Platform",
  description:
    "Extract, standardize, review, and connect ionic-liquid property records and AFM solvation-force curves.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = isAppAuthEnabled();
  const session = authEnabled ? await getCurrentAppSession() : null;
  const viewerIsAdmin = authEnabled && sessionHasAdminRole(session);
  const viewerUser = session?.user as
    | { name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null }
    | undefined;
  const viewerName = viewerUser?.name || viewerUser?.displayUsername || viewerUser?.username || viewerUser?.email || null;
  return (
    <html lang="en">
      <body>
        <WorkspaceNavigationRail authEnabled={authEnabled} viewerIsAdmin={viewerIsAdmin} viewerName={viewerName} />
        <div className="min-h-dvh lg:pl-[190px]">
          <TopNav showMonitor={!authEnabled || viewerIsAdmin} />
          <main className="mx-auto w-full max-w-none px-2 pb-6 pt-3 sm:px-4 lg:px-0 lg:pb-0 lg:pt-0">{children}</main>
        </div>
        <SourceViewer />
        <UsageTracker />
      </body>
    </html>
  );
}
