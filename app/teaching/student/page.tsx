import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TEACHING_COOKIE } from "@/app/api/teaching/_auth";
import { StudentWorkspace } from "@/components/teaching/StudentWorkspace";
import { getCurrentTeachingRound, getTeachingSession } from "@/lib/teaching";

export const dynamic = "force-dynamic";

export default function TeachingStudentPage() {
  const session = getTeachingSession(cookies().get(TEACHING_COOKIE)?.value);
  if (session?.role !== "student" || !session.participantId) redirect("/teaching");
  const workspace = getCurrentTeachingRound(session.participantId);
  if (!workspace) redirect("/teaching");
  return <StudentWorkspace initial={workspace} />;
}
