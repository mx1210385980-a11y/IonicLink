import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI experiment — IonicLink" };

export default function TeachingPage() {
  // The two experiments live on their own subpages; land on Experiment Ⅰ.
  redirect("/teaching/extraction");
}
