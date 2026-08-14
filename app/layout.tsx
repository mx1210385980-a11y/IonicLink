import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { SourceViewer } from "@/components/SourceViewer";
import { WorkspaceNavigationRail } from "@/components/WorkspaceNavigationRail";

export const metadata: Metadata = {
  title: "IonicLink — Ionic Liquid Tribology Database",
  description:
    "Extract, standardize, review, and publish ionic-liquid lubrication measurements from scientific papers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WorkspaceNavigationRail />
        <div className="min-h-dvh lg:pl-20">
          <TopNav />
          <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
        </div>
        <SourceViewer />
      </body>
    </html>
  );
}
