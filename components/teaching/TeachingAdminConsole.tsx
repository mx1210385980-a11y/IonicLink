"use client";

import { useState } from "react";
import { GroupCrossoverAdmin } from "@/components/teaching/GroupCrossoverAdmin";
import { TeacherDashboard } from "@/components/teaching/TeacherDashboard";
import type { TeachingExperimentDashboard } from "@/lib/teachingShared";

type ConsoleView = "group" | "open";

const VIEWS: Array<{
  key: ConsoleView;
  title: string;
  description: string;
  flow: string;
}> = [
  {
    key: "group",
    title: "Group experiment",
    description: "Create an experiment and import a roster. Students join with a code and receive papers by group.",
    flow: "Create experiment → Import roster → Students join → View results",
  },
  {
    key: "open",
    title: "Open experiment",
    description: "Students join with an alias. Papers and round order are balanced automatically.",
    flow: "Share entry link → Students join → View results",
  },
];

export function TeachingAdminConsole({
  initial,
}: {
  initial: TeachingExperimentDashboard;
}) {
  const [view, setView] = useState<ConsoleView>("group");

  const signOut = async () => {
    await fetch("/api/teaching/session", { method: "DELETE" });
    window.location.assign("/teaching");
  };

  return (
    <section lang="en-US" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-9">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950 sm:text-3xl">Teaching lab</h1>
          <p className="mt-1 text-sm text-ink-600">Choose an experiment method and follow the steps on the page.</p>
        </div>
        <button type="button" onClick={() => void signOut()} className="btn min-h-10 px-4">
          Sign out
        </button>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose experiment method">
        {VIEWS.map((item) => {
          const active = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setView(item.key)}
              className={`rounded-[12px] border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-200 ${
                active
                  ? "border-brand-600 bg-brand-50/50 shadow-sm"
                  : "border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50/60"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                    active ? "border-brand-700 bg-brand-700" : "border-ink-300 bg-white"
                  }`}
                >
                  {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
                </span>
                <span className={`text-base font-semibold ${active ? "text-brand-900" : "text-ink-950"}`}>
                  {item.title}
                </span>
              </span>
              <span className="mt-2 block text-sm leading-6 text-ink-600">{item.description}</span>
              <span className="mt-2 block font-mono text-[11px] tracking-wide text-ink-400">{item.flow}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {view === "group" ? <GroupCrossoverAdmin /> : <TeacherDashboard initial={initial} />}
      </div>
    </section>
  );
}
