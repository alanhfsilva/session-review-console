"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth-context";
import { LoginForm } from "./LoginForm";

const ROLE_LABELS: Record<string, string> = {
  clinician: "Clinician",
  supervisor: "Supervisor",
  admin: "Administrator",
};

function Chrome() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  return (
    <header className="chrome">
      <div className="chrome-inner">
        <span className="chrome-brand">Lakeside Session Review</span>
        <nav className="chrome-nav">
          <Link href="/" className={pathname === "/" ? "active" : ""}>
            Session board
          </Link>
        </nav>
        <span className="chrome-user">
          {user.name}
          <span className="chrome-role">{ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
        <button type="button" className="ghost" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    </header>
  );
}

/**
 * Everything behind the sign-in wall renders here. The gate is a convenience,
 * not the control: the API authorises every request on its own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading your workspace...</p>
      </main>
    );
  }

  if (!user) return <LoginForm />;

  return (
    <>
      <Chrome />
      <main className="shell">{children}</main>
    </>
  );
}
