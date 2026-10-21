import { UserManager } from "@/components/admin/UserManager";
import { requireAppPageRole } from "@/lib/auth.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account management — IonicLink" };

export default async function AdminUsersPage() {
  await requireAppPageRole("/admin/users", "admin");
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Account management</h1>
      <p className="mt-2 text-sm leading-6 text-ink-600">
        Create student accounts, reset passwords, and remove accounts. Students cannot register themselves.
      </p>
      <div className="mt-6">
        <UserManager />
      </div>
    </main>
  );
}
