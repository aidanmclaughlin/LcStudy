/**
 * Authentication UI controls.
 *
 * Displays different states based on auth status:
 * - Loading: Disabled button
 * - Signed out: "Sign in" button
 * - Signed in: Avatar button that opens account modal
 *
 * The account modal shows user info and sign out option.
 */

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { signIn, signOut, useSession } from "next-auth/react";

// =============================================================================
// Hooks
// =============================================================================

/**
 * Handle escape key to close modal.
 */
function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onEscape();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onEscape]);
}

/**
 * Lock body scroll when modal is open.
 */
function useBodyScrollLock(isLocked: boolean) {
  useEffect(() => {
    if (!isLocked || typeof document === "undefined") {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isLocked]);
}

// =============================================================================
// Sub-Components
// =============================================================================

interface AvatarProps {
  src: string | null;
  name: string;
  fallback: string;
  className?: string;
}

/** User avatar with fallback initial */
function Avatar({ src, name, fallback, className = "" }: AvatarProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={className}
        referrerPolicy="no-referrer"
      />
    );
  }
  return <span className={`${className} auth-avatar-fallback`}>{fallback}</span>;
}

interface AccountModalProps {
  name: string;
  email: string;
  avatarUrl: string | null;
  fallbackInitial: string;
  onClose: () => void;
}

/** Full-screen modal with user account info */
function AccountModal({ name, email, avatarUrl, fallbackInitial, onClose }: AccountModalProps) {
  return (
    <div
      className="auth-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="auth-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="auth-modal-close"
          aria-label="Close account menu"
          onClick={onClose}
        >
          ×
        </button>
        <div className="auth-modal-avatar-shell">
          <Avatar
            src={avatarUrl}
            name={name}
            fallback={fallbackInitial}
            className={avatarUrl ? "auth-modal-avatar" : "auth-modal-avatar auth-modal-avatar--fallback"}
          />
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
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function AuthControls() {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Track client-side mounting for portal
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Close modal on escape
  useEscapeKey(() => setIsOpen(false));

  // Lock body scroll when modal open
  useBodyScrollLock(isOpen);

  // Loading state
  if (status === "loading") {
    return (
      <button className="auth-chip" type="button" disabled>
        Loading…
      </button>
    );
  }

  // Signed out state
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

  // Signed in state
  const name = session.user.name ?? "Player";
  const email = session.user.email ?? "";
  const avatarUrl = session.user.image ?? null;
  const fallbackInitial = (name || email)[0]?.toUpperCase() ?? "?";

  return (
    <div className="auth-avatar-wrap">
      <button
        type="button"
        className="auth-avatar-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Account menu"
      >
        <Avatar
          src={avatarUrl}
          name={name}
          fallback={fallbackInitial}
          className="auth-avatar-img"
        />
      </button>

      {isOpen && isMounted && createPortal(
        <AccountModal
          name={name}
          email={email}
          avatarUrl={avatarUrl}
          fallbackInitial={fallbackInitial}
          onClose={() => setIsOpen(false)}
        />,
        document.body
      )}
    </div>
  );
}
