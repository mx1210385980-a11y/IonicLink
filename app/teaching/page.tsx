import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TeachingGateway } from "@/components/teaching/TeachingGateway";
import { getTeachingSession } from "@/lib/teaching";
import { TEACHING_COOKIE } from "@/app/api/teaching/_auth";

export const dynamic = "force-dynamic";

export default function TeachingPage() {
  const session = getTeachingSession(cookies().get(TEACHING_COOKIE)?.value);
  if (session?.role === "teacher") redirect("/teaching/admin");
  if (session?.role === "student") redirect("/teaching/student");
  return <TeachingGateway />;
}
