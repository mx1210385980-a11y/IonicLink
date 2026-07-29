import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TEACHING_COOKIE } from "@/app/api/teaching/_auth";
import { TeacherDashboard } from "@/components/teaching/TeacherDashboard";
import { getTeachingAdminDashboard, getTeachingSession } from "@/lib/teaching";

export const dynamic = "force-dynamic";

export default function TeachingAdminPage() {
  const session = getTeachingSession(cookies().get(TEACHING_COOKIE)?.value);
  if (session?.role !== "teacher") redirect("/teaching");
  return <TeacherDashboard initial={getTeachingAdminDashboard()} />;
}
