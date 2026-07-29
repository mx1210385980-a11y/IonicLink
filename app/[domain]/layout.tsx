import { notFound } from "next/navigation";
import { DOMAINS, isDomain } from "@/lib/domain";

export function generateStaticParams() {
  return DOMAINS.map((domain) => ({ domain }));
}

export default function DomainLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { domain: string };
}) {
  if (!isDomain(params.domain)) notFound();
  return <>{children}</>;
}
