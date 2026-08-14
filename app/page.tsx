import { HomePageContent } from "@/components/HomePageContent";
import { requireAppPageSession } from "@/lib/auth.server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireAppPageSession("/");
  return <HomePageContent />;
}
