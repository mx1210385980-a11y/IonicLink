import { SimpleTeacherDashboard } from "@/components/teaching/SimpleTeacherDashboard";
import { simpleExampleDashboard } from "@/lib/teaching/simpleExample";

export default function TeachingExamplePage() {
  const dashboard = simpleExampleDashboard();
  return <SimpleTeacherDashboard example initial={{ experiments: [dashboard.experiment], papers: [], dashboard }} />;
}
