import { notFound } from "next/navigation";
import { isDomain } from "@/lib/domain";
import { DatabaseView } from "@/components/DatabaseView";

export const dynamic = "force-dynamic";

export default function DatabasePage({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  return <DatabaseView domain={params.domain} />;
}
