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
        <div className="min-h-dvh lg:pl-[190px]">
          <TopNav />
          <main className="mx-auto w-full max-w-none px-2 pb-6 pt-3 sm:px-4 lg:px-0 lg:pb-0 lg:pt-0">{children}</main>
        </div>
        <SourceViewer />
      </body>
    </html>
  );
}
