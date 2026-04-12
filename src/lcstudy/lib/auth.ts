/**
 * NextAuth.js configuration and session management.
 *
 * Authentication Flow:
 * 1. User clicks "Sign in with Google"
 * 2. Google OAuth redirects back with user info
 * 3. ensureUser() creates/updates the user in our database
 * 4. JWT token is created with the user's database ID
 * 5. Session includes the database user ID for API authorization
 *
 * @module auth
 */

import NextAuth from "next-auth";
import { getServerSession } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { ensureUser } from "@/lib/db";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get a required environment variable or throw.
 * @param name - Environment variable name
 * @throws Error if the variable is not set
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * NextAuth configuration options.
 * Uses Google OAuth with JWT-based sessions.
 */
export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: requiredEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET")
    })
  ],
  pages: {
    signIn: "/signin"
  },
  callbacks: {
    /**
     * Called when a user signs in.
     * Creates or updates the user in our database.
     */
    async signIn({ user }) {
      const dbUser = await ensureUser({
        email: user.email,
        name: user.name,
        image: user.image
      });
      user.id = dbUser.id;
      return true;
    },

    /**
     * Called when building the session object.
     * Attaches the database user ID to the session.
     */
    async session({ session, token }) {
      if (session.user) {
        if (session.user.email) {
          const dbUser = await ensureUser({
            email: session.user.email,
            name: session.user.name ?? (typeof token.name === "string" ? token.name : null),
            image: session.user.image ?? (typeof token.picture === "string" ? token.picture : null)
          });

          session.user.id = dbUser.id;
          session.user.name = dbUser.name ?? session.user.name;
          session.user.image = dbUser.image ?? session.user.image;
        } else {
          session.user.id = token.userId ?? token.sub ?? undefined;
        }
      }
      return session;
    },

    /**
     * Called when creating a JWT token.
     * Stores the database user ID in the token.
     */
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    }
  },
  session: {
    strategy: "jwt"
  }
} satisfies NextAuthOptions;

// =============================================================================
// Exports
// =============================================================================

const handler = NextAuth(authOptions);

/**
 * Get the current auth session on the server.
 * @returns Session object or null if not authenticated
 */
export async function getAuthSession() {
  return getServerSession(authOptions);
}

/** NextAuth route handlers */
export { handler as GET, handler as POST };
