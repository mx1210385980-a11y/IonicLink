import { TeachingExperimentWorkspace } from "@/components/teaching/TeachingExperimentWorkspace";
import { requireAppPageSession } from "@/lib/auth.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI experiment — IonicLink" };

export default async function TeachingPage() {
  // The teaching module is tied to platform accounts: visitors must sign in first.
  await requireAppPageSession("/teaching");
  return <TeachingExperimentWorkspace />;
}
