import type { Domain } from "../domain";
import type { Module } from "./types";
import { tribologyModule } from "./tribology";
import { conductivityModule } from "./conductivity";
import { diffusionModule } from "./diffusion";

/**
 * Server-safe module registry — the pure half of each domain (prompt, tool
 * schema, mock extractor, ingest, completeness, promoted columns, CSV). Imported
 * by the DB layer, jobs worker, extractor, CSV exporter, and API routes.
 *
 * The client half (RecordCard / RecordEditor; the Design Studio lives in
 * components/design/) is wired in components/registry.client.tsx so
 * React/client code never enters the better-sqlite3 server bundle.
 */
const MODULES: Partial<Record<Domain, Module<any, any>>> = {
  tribology: tribologyModule,
  conductivity: conductivityModule,
  diffusion: diffusionModule,
};

export function getModule(domain: Domain): Module<any, any> {
  const mod = MODULES[domain];
  if (!mod) throw new Error(`No module registered for domain "${domain}"`);
  return mod;
}
