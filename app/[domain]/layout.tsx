import { notFound } from "next/navigation";
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
  // Domain pages are public by default; write pages (extract) guard themselves.
  return <>{children}</>;
}
