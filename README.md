# Movie Memory

Sign in with Google, save your favorite movie, and get a fun fact about it from OpenAI.

**Variant: A (Backend-Focused: Caching & Correctness)**

Stack: Next.js 16 (App Router), TypeScript, React 19, Tailwind CSS 4, Postgres, Prisma 6, Auth.js (Google), OpenAI, Vitest.

## Setup

Requires Node.js 20.9+, a Postgres database, a Google OAuth client, and an OpenAI API key.

1. Create a Google OAuth client (Web application) with redirect URI `http://localhost:3000/api/auth/callback/google`.
2. Install, configure, migrate, run:

```bash
npm install                 # also runs prisma generate
cp .env.example .env        # fill in the values below
npx prisma migrate deploy
npm run dev                 # http://localhost:3000
```

Tests: `npm test` (no database or API key needed).

## Environment variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | Auth.js secret (`npx auth secret`) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Optional, defaults to `gpt-4o-mini` |

## Database migrations

- Apply migrations: `npx prisma migrate deploy`
- After changing `prisma/schema.prisma`: `npx prisma migrate dev --name <change>`

## Architecture overview

```
/              landing + "Sign in with Google"; signed-in users go to /onboarding or /dashboard
/onboarding    server action validates the movie (zod) and saves it once
/dashboard     profile, favorite movie, logout; fun fact loaded from GET /api/fact
/api/fact      session -> user -> src/lib/facts/service.ts -> Postgres + OpenAI
```

**Data model.** `User` (Google profile + `favoriteMovie`), `Account` and `Session` (Auth.js), and `MovieFact` (`userId`, `movie`, `content`, `status`, `cacheWindow`, `createdAt`). `MovieFact` has a unique key on `(userId, movie, cacheWindow)` and an index for "latest fact for this user and movie".

**Auth.** Auth.js with Google and database sessions, so logout revokes the session. A user with no saved movie goes to onboarding, otherwise to the dashboard. Every page, action and route checks the session itself; user ids never come from the request.

**Fact generation** (`src/lib/facts/service.ts`):

1. If the latest fact for this user + movie is under 60 s old, return it.
2. Otherwise insert a `PENDING` row for the current minute (`cacheWindow = floor(now / 60s)`). The unique key lets only one request win.
3. The winner calls OpenAI, saves the fact as `READY`, and returns it.
4. Other requests (extra tabs, fast refreshes) don't call OpenAI. They wait for the winner's row and return the same fact.
5. If OpenAI fails or times out (10 s), the claim is deleted and the most recent cached fact is returned, or a friendly error if there is none.

**Security.** Server-side validation (trim, 1 to 100 chars, no control characters), all queries scoped to the session user, secrets only in server-only modules, fallbacks for missing Google name or photo.

## Why Variant A

The core problems here are backend correctness: when to reuse a fact, stopping duplicate OpenAI calls, and handling OpenAI failures. They are testable and matter most for cost and reliability.

## Key tradeoffs

- **DB unique constraint instead of an in-memory lock:** works across multiple server instances, at the cost of one extra insert.
- **Claim before calling OpenAI:** losing requests never pay for an API call, at the cost of a `PENDING` state to clean up.
- **Losers poll for the winner's result:** all tabs show the same fact, but a waiting request holds a connection for a few seconds.
- **Database sessions over JWT:** real logout, at the cost of one DB lookup per request.

## With 2 more hours

- Integration tests against real Postgres and an end-to-end test of the login flow.
- Treat stale `PENDING` rows as abandoned so a crashed request never makes others wait.
- Rate limiting on `/api/fact`.
- Let users change their favorite movie.

## AI usage
- Used it to reason through the concurrency design and the 60-second window edge cases.
