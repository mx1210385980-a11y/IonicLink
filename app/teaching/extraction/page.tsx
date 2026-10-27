import { TeachingExtractionExperiment } from "@/components/teaching/TeachingExperimentWorkspace";
import { getCurrentAppSession, isAppAuthEnabled, requireAppPageSession, sessionHasAdminRole } from "@/lib/auth.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Experiment Ⅰ- Data Extraction — IonicLink" };

export default async function TeachingExtractionPage() {
  // The teaching module is tied to platform accounts: visitors must sign in first.
  await requireAppPageSession("/teaching/extraction");
  // Administrators run and review the experiment; students join and extract.
  const isAdmin = !isAppAuthEnabled() || sessionHasAdminRole(await getCurrentAppSession());
  return <TeachingExtractionExperiment isAdmin={isAdmin} />;
}
