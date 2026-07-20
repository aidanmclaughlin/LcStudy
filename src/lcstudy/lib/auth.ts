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
import type { NextAuthOptions, Provider } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

import { ensureUser } from "@/lib/db";

const isDev = process.env.NODE_ENV !== "production";
const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

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
const providers: Provider[] = [];

if (hasGoogle) {
  providers.push(
    GoogleProvider({
      clientId: requiredEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET")
    })
  );
}

if (isDev) {
  providers.push(
    CredentialsProvider({
      id: "dev-credentials",
      name: "Dev login",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "dev@localhost" }
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim() || "dev@localhost";
        const dbUser = await ensureUser({
          email,
          name: email.split("@")[0],
          image: null
        });
        return {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name ?? email.split("@")[0],
          image: dbUser.image ?? null
        };
      }
    })
  );
}

export const authOptions = {
  providers,
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
