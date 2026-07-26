import { notFound } from "next/navigation";
import { isDomain } from "@/lib/domain";
import { WffStrategyPanel } from "@/components/design/WffStrategyPanel";

export const dynamic = "force-dynamic";

export default function DesignEvaluationPage({ params }: { params: { domain: string } }) {
  if (!isDomain(params.domain) || params.domain !== "tribology") notFound();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-8 pt-5 sm:px-6 lg:px-8">
      <WffStrategyPanel />
    </main>
  );
}
