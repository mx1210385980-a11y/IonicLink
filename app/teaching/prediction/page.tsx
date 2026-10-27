import { TeachingPredictionExperiment } from "@/components/teaching/TeachingExperimentWorkspace";
import { requireAppPageSession } from "@/lib/auth.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Experiment Ⅱ- Prediction of μ — IonicLink" };

export default async function TeachingPredictionPage() {
  // The teaching module is tied to platform accounts: visitors must sign in first.
  await requireAppPageSession("/teaching/prediction");
  return <TeachingPredictionExperiment />;
}
