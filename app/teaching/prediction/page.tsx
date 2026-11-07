import { TeachingPredictionExperiment } from "@/components/teaching/TeachingExperimentWorkspace";
import { getCurrentAppSession, isAppAuthEnabled, requireAppPageSession, sessionHasAdminRole } from "@/lib/auth.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Experiment Ⅱ- Prediction of μ — IonicLink" };

export default async function TeachingPredictionPage() {
  // The teaching module is tied to platform accounts: visitors must sign in first.
  await requireAppPageSession("/teaching/prediction");
  // Platform administrators review submissions; students tune and submit.
  const isAdmin = !isAppAuthEnabled() || sessionHasAdminRole(await getCurrentAppSession());
  return <TeachingPredictionExperiment isAdmin={isAdmin} />;
}
