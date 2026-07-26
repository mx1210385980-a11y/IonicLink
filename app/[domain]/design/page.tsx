import { notFound } from "next/navigation";
import { listRecords } from "@/lib/db";
import { isDomain } from "@/lib/domain";
import { DesignStudio } from "@/components/design/DesignStudio";

export const dynamic = "force-dynamic";

/**
 * Design Studio — property prediction & new-materials design, per domain.
 * The server hands the domain's records to one generic client component;
 * all prediction math runs client-side and is never persisted.
 */
export default function DesignPage({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  return (
    <DesignStudio
      domain={domain}
      records={listRecords(domain) as any[]}
      evaluationLabHref={domain === "tribology" ? `/${domain}/design/evaluation` : null}
    />
  );
}
