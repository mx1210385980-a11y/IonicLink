import { redirect } from "next/navigation";
import { HomePageContent } from "@/components/HomePageContent";
import { getCurrentAppSession, isAppAuthEnabled } from "@/lib/auth.server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Login-first landing: with auth enabled, the sign-in screen is the front
  // door. Guests can still deep-link the public database pages directly.
  if (isAppAuthEnabled() && !(await getCurrentAppSession())) {
    redirect("/login");
  }
  return <HomePageContent />;
}
