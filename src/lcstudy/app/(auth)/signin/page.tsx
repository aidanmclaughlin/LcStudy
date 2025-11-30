/**
 * Sign-in page.
 *
 * Displays a simple sign-in card with Google OAuth button.
 * This page is shown when users are not authenticated.
 */

"use client";

import { signIn } from "next-auth/react";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10 text-slate-100">
      <div className="w-full max-w-md rounded-3xl bg-slate-900/70 p-10 shadow-panel backdrop-blur">
        <h1 className="text-3xl font-bold">Sign in to LcStudy</h1>
        <p className="mt-3 text-sm text-slate-300">
          Predict Leela&apos;s moves, track your streaks, and watch your win rate climb.
        </p>
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="mt-8 w-full rounded-full bg-white/90 py-3 text-base font-semibold text-slate-900 transition hover:bg-white"
        >
          Continue with Google
        </button>
      </div>
    </main>
  );
}
