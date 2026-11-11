import type { HTMLAttributes } from "react";
import { SCHOOL_WORKSPACE_PAGE } from "./workspaceStyles";

/** Shared page rhythm for extraction, classroom and AFM workspaces. */
export function WorkspacePageFrame({ children, className = "", variant = "workspace", ...props }: HTMLAttributes<HTMLElement> & { "data-testid"?: string; variant?: "workspace" | "school" }) {
  const school = variant === "school";
  return <section {...props} data-workspace-theme={school ? "school" : undefined} className={`${school ? SCHOOL_WORKSPACE_PAGE : "min-h-dvh bg-[#fafafa] px-4 py-6 font-sans text-ink-900 sm:px-8 lg:px-10 lg:py-8"} ${className}`}>
    <div className={`mx-auto min-w-0 w-full ${school ? "max-w-[1264px]" : "max-w-[1240px]"}`}>{children}</div>
  </section>;
}
