"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export function AuthControls() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <button className="auth-chip" type="button" disabled>
        Loading…
      </button>
    );
  }

  if (!session?.user) {
    return (
      <button
        className="auth-chip"
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/" })}
      >
        Sign in
      </button>
    );
  }

  return (
    <div className="auth-chip-group">
      {session.user.email && (
        <span className="auth-chip auth-chip--ghost">{session.user.email}</span>
      )}
      <button
        className="auth-chip"
        type="button"
        onClick={() => signOut({ callbackUrl: "/signin" })}
      >
        Sign out
      </button>
    </div>
  );
}
