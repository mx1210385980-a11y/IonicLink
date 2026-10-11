import { cookies } from "next/headers";
import { TEACHING_COOKIE } from "@/app/api/teaching/_auth";
import { SimpleTeacherDashboard } from "@/components/teaching/SimpleTeacherDashboard";
import { TeachingGateway } from "@/components/teaching/TeachingGateway";
import { getTeachingSession } from "@/lib/teaching";
import { getSimpleDashboard, listSimpleExperiments } from "@/lib/teaching/simpleStore";

export const dynamic = "force-dynamic";

export default function TeachingAdminPage() {
  const session = getTeachingSession(cookies().get(TEACHING_COOKIE)?.value);
  if (session?.role !== "teacher") return <TeachingGateway initialMode="teacher" />;
  const experiments = listSimpleExperiments();
  return <SimpleTeacherDashboard initial={{ experiments, papers: [],
    dashboard: experiments.length ? getSimpleDashboard(experiments[0].id) : null }} />;
}
