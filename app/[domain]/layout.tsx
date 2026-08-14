import { notFound } from "next/navigation";
import { requireAppPageSession } from "@/lib/auth.server";
import { DOMAINS, isDomain } from "@/lib/domain";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return DOMAINS.map((domain) => ({ domain }));
}

export default async function DomainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { domain: string };
}) {
  if (!isDomain(params.domain)) notFound();
  await requireAppPageSession(`/${params.domain}`);
  return <>{children}</>;
}
