"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { signIn, signOut, useSession } from "next-auth/react";

export function AuthControls() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

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
        className="auth-chip auth-chip--primary"
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/" })}
      >
        Sign in
      </button>
    );
  }

  const toggle = () => setOpen((value) => !value);
  const name = session.user.name ?? "Player";
  const email = session.user.email ?? "";
  const avatarUrl = session.user.image ?? null;
  const fallbackInitial = (name || email)[0]?.toUpperCase() ?? "?";

  return (
    <div className="auth-avatar-wrap">
      <button
        type="button"
        className="auth-avatar-btn"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={name} className="auth-avatar-img" referrerPolicy="no-referrer" />
        ) : (
          <span className="auth-avatar-fallback">{fallbackInitial}</span>
        )}
      </button>
      {open && mounted
        ? createPortal(
            <div
              className="auth-modal-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setOpen(false)}
            >
              <div
                className="auth-modal"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="auth-modal-close"
                  aria-label="Close account menu"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
                <div className="auth-modal-avatar-shell">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt={name} className="auth-modal-avatar" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="auth-modal-avatar auth-modal-avatar--fallback">{fallbackInitial}</span>
                  )}
                </div>
                <div className="auth-modal-header">
                  <span className="auth-modal-name">{name}</span>
                  {email && <span className="auth-modal-email">{email}</span>}
                </div>
                <div className="auth-modal-actions">
                  <button
                    type="button"
                    className="auth-modal-signout"
                    onClick={() => signOut({ callbackUrl: "/signin" })}
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
