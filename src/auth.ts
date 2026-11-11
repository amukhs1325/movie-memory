import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

// Auth.js reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the
// environment. None of them are ever sent to the browser.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  // Database sessions: the cookie is an opaque random token, and the session
  // lives in Postgres, so sign-out revokes it server-side.
  session: { strategy: "database" },
  // "/" is the login page (landing page with "Sign in with Google").
  pages: { signIn: "/", error: "/" },
  callbacks: {
    session({ session, user }) {
      // Expose the database user id so server code can authorize by it.
      session.user.id = user.id;
      return session;
    },
  },
});
