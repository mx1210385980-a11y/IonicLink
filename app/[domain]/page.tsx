import { notFound, redirect } from "next/navigation";
import { isDomain } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default function DomainHome({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  redirect("/");
}
