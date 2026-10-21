"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  role?: string | null;
  createdAt: string | Date;
};

type BatchResult = { studentId: string; ok: boolean; error?: string };

function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").split(",").map((part) => part.trim()).includes("admin");
}

const inputClass =
  "mt-2 min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function UserManager() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setListError(null);
    const result = await authClient.admin.listUsers({ query: { limit: 500 } });
    if (result.error) {
      setListError(result.error.message ?? "Could not load the user list.");
      return;
    }
    const data = result.data as { users?: ManagedUser[] } | null;
    setUsers(data?.users ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adminBusy) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setAdminBusy(true);
    setAdminError(null);
    setAdminNotice(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          role: "admin",
          account: String(form.get("email") ?? "").trim(),
          name: String(form.get("name") ?? "").trim(),
          password: String(form.get("password") ?? ""),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setAdminError(payload.error ?? "Could not create the administrator account.");
        return;
      }
      formEl.reset();
      setAdminNotice(`Administrator account created for ${String(form.get("email") ?? "").trim()}.`);
      await refresh();
    } finally {
      setAdminBusy(false);
    }
  }

  async function createStudentBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (batchBusy) return;
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const studentIds = String(form.get("studentIds") ?? "")
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "batch", studentIds }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; results?: BatchResult[] };
      if (!response.ok) {
        setBatchError(payload.error ?? "Could not create the student accounts.");
        return;
      }
      formEl.reset();
      setBatchResults(payload.results ?? []);
      await refresh();
    } finally {
      setBatchBusy(false);
    }
  }

  async function resetPassword(user: ManagedUser) {
    const next = window.prompt(`New password for ${user.name} (at least 8 characters):`);
    if (!next) return;
    if (next.length < 8) {
      window.alert("The password must contain at least 8 characters.");
      return;
    }
    setBusyUserId(user.id);
    try {
      const result = await authClient.admin.setUserPassword({ userId: user.id, newPassword: next });
      if (result.error) window.alert(result.error.message ?? "Could not reset the password.");
      else window.alert("Password updated.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeUser(user: ManagedUser) {
    if (!window.confirm(`Delete the account of ${user.name}? This cannot be undone.`)) return;
    setBusyUserId(user.id);
    try {
      const result = await authClient.admin.removeUser({ userId: user.id });
      if (result.error) window.alert(result.error.message ?? "Could not delete the account.");
      else await refresh();
    } finally {
      setBusyUserId(null);
    }
  }

  const batchCreated = batchResults?.filter((result) => result.ok).length ?? 0;

  return (
    <div className="space-y-6">
      <section className="panel p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight text-ink-950">Create an administrator account</h2>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          Administrators sign in with their email and have full access, including account management, review approval, and the teaching dashboard. Create one account at a time.
        </p>
        <form className="mt-5 grid gap-4 sm:grid-cols-3" onSubmit={createAdmin}>
          <label className="block">
            <span className="text-sm font-semibold text-ink-800">Email</span>
            <input
              autoComplete="off"
              className={inputClass}
              name="email"
              placeholder="admin@example.edu.cn"
              required
              spellCheck={false}
              type="email"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink-800">Name</span>
            <input autoComplete="off" className={inputClass} name="name" placeholder="Administrator name" required type="text" />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink-800">Password</span>
            <input
              autoComplete="new-password"
              className={inputClass}
              maxLength={128}
              minLength={8}
              name="password"
              placeholder="At least 8 characters"
              required
              type="text"
            />
          </label>
          <div className="sm:col-span-3">
            <button className="btn-primary" disabled={adminBusy} type="submit">
              {adminBusy ? "Creating…" : "Create administrator"}
            </button>
          </div>
        </form>
        {adminError ? (
          <div className="mt-4 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
            {adminError}
          </div>
        ) : null}
        {adminNotice ? (
          <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-700" role="status">
            {adminNotice}
          </div>
        ) : null}
      </section>

      <section className="panel p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight text-ink-950">Create student accounts in bulk</h2>
        <p className="mt-2 text-sm leading-6 text-ink-600">
          Enter student IDs (one per line, or separated by spaces/commas). Each account signs in with the student ID as
          username and the default initial password <code className="rounded bg-ink-50 px-1 font-mono text-[13px]">studentId@Njust</code> —
          e.g. <code className="rounded bg-ink-50 px-1 font-mono text-[13px]">2023001001@Njust</code>. Students can change it after signing in.
        </p>
        <form className="mt-5" onSubmit={createStudentBatch}>
          <label className="block">
            <span className="text-sm font-semibold text-ink-800">Student IDs</span>
            <textarea
              autoCapitalize="none"
              className="mt-2 min-h-32 w-full rounded-[8px] border border-ink-200 bg-white px-3.5 py-2.5 font-mono text-sm text-ink-950 outline-none transition placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              name="studentIds"
              placeholder={"2023001001\n2023001002\n2023001003"}
              required
              spellCheck={false}
            />
          </label>
          <div className="mt-4">
            <button className="btn-primary" disabled={batchBusy} type="submit">
              {batchBusy ? "Creating…" : "Create student accounts"}
            </button>
          </div>
        </form>
        {batchError ? (
          <div className="mt-4 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
            {batchError}
          </div>
        ) : null}
        {batchResults ? (
          <div className="mt-4 rounded-[8px] border border-ink-100 bg-ink-50/60 px-3.5 py-3 text-sm" role="status">
            <p className="font-semibold text-ink-800">
              {batchCreated} of {batchResults.length} accounts created.
            </p>
            {batchResults.some((result) => !result.ok) ? (
              <ul className="mt-2 space-y-1 text-rose-700">
                {batchResults
                  .filter((result) => !result.ok)
                  .map((result) => (
                    <li key={result.studentId}>
                      <span className="font-mono">{result.studentId}</span> — {result.error}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="panel p-6 sm:p-8">
        <h2 className="text-xl font-semibold tracking-tight text-ink-950">Accounts</h2>
        {listError ? (
          <div className="mt-4 rounded-[8px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-700" role="alert">
            {listError}
          </div>
        ) : null}
        {!users && !listError ? (
          <p className="mt-4 text-sm text-ink-500">Loading…</p>
        ) : null}
        {users ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Student ID / email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr className="border-b border-ink-50" key={user.id}>
                    <td className="py-2.5 pr-4 font-medium text-ink-900">{user.name}</td>
                    <td className="py-2.5 pr-4 text-ink-600">
                      {user.username ?? user.email}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          isAdminRole(user.role) ? "bg-brand-100 text-brand-800" : "bg-ink-100 text-ink-600"
                        }`}
                      >
                        {isAdminRole(user.role) ? "Admin" : "Student"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex gap-2">
                        <button
                          className="rounded-[6px] border border-ink-200 bg-white px-2.5 py-1 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busyUserId === user.id}
                          onClick={() => void resetPassword(user)}
                          type="button"
                        >
                          Reset password
                        </button>
                        <button
                          className="rounded-[6px] border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busyUserId === user.id}
                          onClick={() => void removeUser(user)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 ? (
                  <tr>
                    <td className="py-4 text-sm text-ink-500" colSpan={4}>
                      No accounts yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
