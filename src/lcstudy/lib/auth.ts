import NextAuth from "next-auth";
import { getServerSession } from "next-auth";
import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { ensureUser, getUserByEmail } from "@/lib/db";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

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
    async signIn({ user }) {
      const dbUser = await ensureUser({
        email: user.email,
        name: user.name,
        image: user.image
      });
      user.id = dbUser.id;
      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId ?? token.sub ?? undefined;
        if (session.user.email && !session.user.name) {
          const dbUser = await getUserByEmail(session.user.email);
          session.user.name = dbUser?.name ?? session.user.name;
          session.user.image = dbUser?.image ?? session.user.image;
        }
      }
      return session;
    },
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

const handler = NextAuth(authOptions);

export async function getAuthSession() {
  return getServerSession(authOptions);
}

export { handler as GET, handler as POST };
