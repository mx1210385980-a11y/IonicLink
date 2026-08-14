import { notFound, redirect } from "next/navigation";
import { isDomain } from "@/lib/domain";

export const dynamic = "force-dynamic";

export default function DesignEvaluationPage({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain) || params.domain !== "tribology") notFound();
  redirect(`/${params.domain}/design`);
}
