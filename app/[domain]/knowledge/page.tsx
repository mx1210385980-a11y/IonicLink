import { notFound, redirect } from "next/navigation";
import { isDomain } from "@/lib/domain";

/** The knowledge page became the Design Studio — keep old links working. */
export default function KnowledgeRedirect({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain)) notFound();
  redirect(`/${params.domain}/design`);
}
