import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { ProfileForm } from "@/components/auth/ProfileForm";
import { requireAppPageSession, sessionHasAdminRole } from "@/lib/auth.server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  // Any signed-in account (student or administrator) manages its profile here.
  const session = await requireAppPageSession("/account");
  const user = session?.user as
    | { name?: string | null; displayUsername?: string | null; username?: string | null; email?: string | null }
    | undefined;
  const account = user?.displayUsername || user?.username || user?.email || "";
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-1 py-10">
      <ProfileForm
        account={account}
        initialName={user?.name || account}
        roleLabel={sessionHasAdminRole(session) ? "Administrator" : "Student"}
      />
      <ChangePasswordForm />
    </div>
  );
}
