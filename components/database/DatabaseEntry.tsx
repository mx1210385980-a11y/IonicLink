"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { DatabaseInitialData } from "@/lib/databasePayload";
import type { Domain } from "@/lib/domain";

type DomainDatabaseProps = { initialData: DatabaseInitialData };

function DatabaseModuleLoading() {
  return (
    <div aria-busy="true" aria-label="Loading database tools" className="panel min-h-64 animate-pulse rounded-xl p-5">
      <div className="h-10 w-56 rounded-lg bg-ink-100" />
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="h-32 rounded-xl bg-ink-50" />
        <div className="h-32 rounded-xl bg-ink-50" />
      </div>
    </div>
  );
}

const DATABASE_VIEWS: Record<Domain, ComponentType<DomainDatabaseProps>> = {
  tribology: dynamic(
    () => import("@/components/database/TribologyDatabaseView").then((module) => module.TribologyDatabaseView),
    { loading: DatabaseModuleLoading }
  ),
  conductivity: dynamic(
    () => import("@/components/database/ConductivityDatabaseView").then((module) => module.ConductivityDatabaseView),
    { loading: DatabaseModuleLoading }
  ),
  diffusion: dynamic(
    () => import("@/components/database/DiffusionDatabaseView").then((module) => module.DiffusionDatabaseView),
    { loading: DatabaseModuleLoading }
  ),
};

export function DatabaseEntry({
  domain,
  initialData,
}: {
  domain: Domain;
  initialData: DatabaseInitialData;
}) {
  const DomainDatabaseView = DATABASE_VIEWS[domain];
  return <DomainDatabaseView initialData={initialData} />;
}
