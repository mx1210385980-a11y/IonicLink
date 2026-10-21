import { notFound } from "next/navigation";
import { DatabaseEntry } from "@/components/database/DatabaseEntry";
import { getCurrentAppSession, isAppAuthEnabled, sessionHasAdminRole } from "@/lib/auth.server";
import { getDatabasePayload } from "@/lib/database.server";
import { isDomain } from "@/lib/domain";
import type { DatabaseInitialData } from "@/lib/databasePayload";
import type { RecordStatus } from "@/lib/schema";

export const dynamic = "force-dynamic";

export default async function DatabasePage({
  params,
  searchParams,
}: {
  params: { domain: string };
  searchParams?: { status?: string | string[] };
}) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const statusParam = Array.isArray(searchParams?.status) ? searchParams?.status[0] : searchParams?.status;
  let status: RecordStatus = statusParam === "review" ? "review" : "official";
  // Anonymous visitors may only browse the official (checked) database.
  const appSession = await getCurrentAppSession();
  if (isAppAuthEnabled() && !appSession) status = "official";
  const query = new URLSearchParams({ status }).toString();
  const initialData: DatabaseInitialData = {
    ...getDatabasePayload(domain, { status }),
    status,
    queryKey: `${domain}?${query}`,
  };

  return (
    <div className="relative left-1/2 w-[100dvw] max-w-[100dvw] -translate-x-1/2 px-2 sm:px-4 lg:w-[calc(100dvw-150px)] lg:max-w-[calc(100dvw-150px)] lg:px-5 2xl:px-7">
      <DatabaseEntry
        domain={domain}
        initialData={initialData}
        canModerate={!isAppAuthEnabled() || sessionHasAdminRole(appSession)}
        viewerSignedIn={!isAppAuthEnabled() || Boolean(appSession)}
      />
    </div>
  );
}
