/**
 * React context providers for the application.
 *
 * Wraps the entire app with NextAuth SessionProvider
 * to enable useSession() hook throughout the client.
 */

"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return <SessionProvider>{children}</SessionProvider>;
}
