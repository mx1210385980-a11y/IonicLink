import { UsageMonitor } from "@/components/monitor/UsageMonitor";
import { requireAppPageRole } from "@/lib/auth.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage monitor — IonicLink" };

export default async function MonitorPage() {
  // Usage monitoring is visible to administrators only.
  await requireAppPageRole("/monitor", "admin");
  return <UsageMonitor />;
}
