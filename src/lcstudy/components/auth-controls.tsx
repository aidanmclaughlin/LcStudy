"use client";

import { signOut, useSession } from "next-auth/react";

export function SignOutButton({ className = "" }: { className?: string }) {
  const { status } = useSession();

  return (
    <button
      type="button"
      className={className}
      disabled={status === "loading"}
      onClick={() => signOut({ callbackUrl: "/signin" })}
    >
      Sign out
    </button>
  );
}
