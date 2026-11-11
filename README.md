# Movie Memory

Sign in with Google, save your favorite movie, and get a fun fact about it from OpenAI.

**Variant chosen: A (Backend-Focused: Caching & Correctness)**

Stack: TypeScript, Next.js 16 (App Router), React 19, Tailwind CSS 4, Postgres, Prisma 6, Auth.js (NextAuth v5) with Google OAuth, OpenAI API, Vitest.

---

## Setup

### 1. Prerequisites

- Node.js 20.9 or newer
- A Postgres database (local install, Docker, Neon, Supabase, etc.)
- A Google OAuth client
- An OpenAI API key

Quick local Postgres with Docker:

```bash
docker run --name movie-memory-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=movie_memory -p 5432:5432 -d postgres:16
```

### 2. Google OAuth client

1. Google Cloud Console > APIs & Services > Credentials > Create credentials > OAuth client ID.
2. Application type: **Web application**.
3. Authorized JavaScript origin: `http://localhost:3000`
4. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Copy the client ID and secret into `.env`.

### 3. Install, configure, migrate, run

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then fill in the values (see below)
npx prisma migrate deploy        # creates the tables
npm run dev                      # http://localhost:3000
```

### 4. Tests

```bash
npm test          # unit tests (no database or API key needed)
npm run typecheck
npm run lint
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | Secret used by Auth.js to sign cookies. Generate with `npx auth secret` or `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret |
| `OPENAI_API_KEY` | yes | OpenAI API key |
| `OPENAI_MODEL` | no | Model name, defaults to `gpt-4o-mini` |
| `AUTH_URL` / `AUTH_TRUST_HOST` | prod only | Needed when deploying somewhere other than Vercel |

None of these are prefixed with `NEXT_PUBLIC_`, so none of them can end up in the browser bundle.

## Database migrations

The schema lives in `prisma/schema.prisma` and the SQL migrations in `prisma/migrations/`.

| Task | Command |
| --- | --- |
| Apply existing migrations (fresh DB, CI, production) | `npx prisma migrate deploy` |
| Change the schema during development | edit `schema.prisma`, then `npx prisma migrate dev --name <change>` |
| Regenerate the Prisma client | `npx prisma generate` (runs automatically after `npm install`) |
| Browse the data | `npx prisma studio` |

---

## Architecture overview

### Request flow

```
Browser
  │
  ├── GET /              landing page with "Sign in with Google"
  │                      signed in?  no movie -> /onboarding, has movie -> /dashboard
  ├── /api/auth/*        Auth.js: Google redirect + callback, sign-out, CSRF
  ├── GET /onboarding    form -> server action saveFavoriteMovie (zod validation)
  ├── GET /dashboard     profile + favorite movie (server rendered)
  │     └── <FunFact/>   client component, calls GET /api/fact
  └── GET /api/fact      session -> user -> fact service
                                           │
                     ┌─────────────────────┴──────────────────────┐
                     │  src/lib/facts/service.ts (pure logic)     │
                     │  cache check -> claim window -> OpenAI     │
                     └───────┬───────────────────────┬────────────┘
                             │                       │
                   prisma-store.ts (Postgres)   openai.ts (OpenAI SDK)
```

### Folder layout

```
prisma/
  schema.prisma              data model
  migrations/                SQL migrations
src/
  auth.ts                    Auth.js config (Google, Prisma adapter, DB sessions)
  lib/
    db.ts                    Prisma client singleton
    current-user.ts          getCurrentUser / requireUser (the only way to get "who is asking")
    validation.ts            zod schema for movie titles
    movie-limits.ts          shared min/max length constants
    facts/
      service.ts             cache + burst protection + fallback logic (no I/O of its own)
      prisma-store.ts        Postgres implementation of the FactStore interface
      openai.ts              OpenAI call with timeout and prompt hardening
      index.ts               wires the service to Postgres + OpenAI
  app/
    page.tsx                 landing / login
    onboarding/              page, client form, server action
    dashboard/               page, FunFact client component
    api/auth/[...nextauth]/  Auth.js route handlers
    api/fact/route.ts        GET fun fact for the signed-in user
tests/
  fact-service.test.ts       cache window, burst protection, failure handling, user isolation
  fact-route.test.ts         API authorization
  validation.test.ts         input validation
  helpers/memory-store.ts    in-memory FactStore that enforces the same unique key as Postgres
```

### Data model

| Table | Purpose |
| --- | --- |
| `User` | Google profile (name, email, image, all nullable) plus `favoriteMovie`. `favoriteMovie IS NULL` means onboarding is not finished. |
| `Account` | Google account link, managed by Auth.js. |
| `Session` | Server-side session, managed by Auth.js. The cookie only holds an opaque random token. |
| `MovieFact` | One row per generated fact: `userId`, `movie`, `content`, `status` (`PENDING` / `READY`), `cacheWindow`, `createdAt`. |

Key decisions:

- **Favorite movie is a column on `User`, not its own table.** A user has exactly one favorite movie and nothing else references movies, so a separate table would add a join without adding value.
- **`MovieFact.movie` stores the title.** The spec says "most recent fact for this user + movie". Keeping the title on each fact means the cache is keyed exactly that way, and old facts never get attached to a different movie if editing the movie is added later.
- **`@@unique([userId, movie, cacheWindow])`** is the burst protection (details below).
- **`@@index([userId, movie, status, createdAt DESC])`** makes "latest READY fact for this user and movie" a single index lookup.
- **Facts are never updated once READY**, so the table is also a history of every fact a user has seen.
- **`onDelete: Cascade`** on every user relation, so deleting a user removes all of their data.

### Authentication and routing

- Auth.js with the Google provider and the Prisma adapter, using **database sessions**. The session lives in Postgres, so logging out deletes it and the old cookie stops working immediately. (With JWT sessions, a stolen cookie would stay valid until it expires.)
- "First-time vs returning" is decided by data, not by login count: if `favoriteMovie` is empty the user goes to onboarding, otherwise to the dashboard. A user who signs in but closes the tab before picking a movie is sent back to onboarding next time, which a "first login" flag would get wrong.
- Every page, server action and route handler checks the session itself through `getCurrentUser()` / `requireUser()`. There is no middleware-only protection: middleware is easy to misconfigure and has been bypassed before, so the check sits right next to the data access.
- Logged out and visiting `/dashboard` or `/onboarding` redirects to `/` (the login page). `/api/fact` returns `401`.

### Variant A: how fact generation works

All of this lives in `src/lib/facts/service.ts`.

1. **Cache check.** Load the latest `READY` fact for (user, movie). If `now - createdAt < 60s`, return it.
2. **Claim the window.** Otherwise insert a `PENDING` row with `cacheWindow = floor(now / 60s)`. Because of the unique constraint on (userId, movie, cacheWindow), only one request in the whole system can succeed. Everyone else gets a unique-violation error (Prisma `P2002`), which the store turns into "already claimed".
3. **The winner** calls OpenAI, writes the content, flips the row to `READY`, and returns it.
4. **Everyone else** (other tabs, rapid refreshes, other server instances) does not call OpenAI. They poll the claimed row every 250 ms and return the winner's fact as soon as it is ready.

Why a fixed window never blocks a needed regeneration: a fact created at time `t` is in window `floor(t / 60s)`. It only goes stale at `t + 60s`, which is always in a later window. So the claim for the next fact can never collide with the fact it replaces. `createdAt` and `cacheWindow` are computed from the same app timestamp so they can't disagree.

### Failure handling

| Situation | Result |
| --- | --- |
| OpenAI times out (10 s) or errors | The `PENDING` claim is deleted so the next request can retry right away. Return the most recent cached fact (even if older than 60 s). If there is none, return a friendly error (HTTP 503). |
| A waiting request sees the claim disappear | The winner failed: same fallback as above. |
| The winner crashes mid-request and leaves a `PENDING` row | Waiters give up after 11 s and use the fallback. The stuck row only blocks its own 60 s window; the next window can be claimed normally, so the system heals itself. |
| OpenAI returns an empty reply | Treated as a failure. |

The OpenAI SDK is set to `maxRetries: 0` on purpose: a cached fallback is available instantly, so retrying would only make the user wait longer.

### Security

- **Authorization by construction.** `GET /api/fact` takes no parameters. The user id comes from the server-side session and the movie from that user's row, so there is no input a caller could change to read someone else's facts. Every query in `prisma-store.ts` filters by `userId`.
- **Server-side validation** (`src/lib/validation.ts`): unicode-normalize, collapse whitespace, trim, require 1 to 100 characters (one character because real titles like *M* exist), reject control characters. The DB column is `VARCHAR(100)` as a second line of defense. Browser `maxLength` is only a convenience.
- **Onboarding is first-time only**, enforced in the database: `updateMany where favoriteMovie IS NULL`. A replayed or double-submitted form changes nothing.
- **Secrets stay on the server.** `db.ts`, `openai.ts`, `current-user.ts` and `facts/index.ts` import `server-only`, which makes the build fail if any of them is ever imported into client code. No env var is `NEXT_PUBLIC_`.
- **Prompt injection.** The title is sent as JSON-encoded data in the user message, and the system prompt says to treat it only as a title. Output is length-capped and rendered as plain text (React escapes it), so even a manipulated reply can't inject HTML.
- **CSRF.** Server actions check the `Origin` header; Auth.js uses its own CSRF token.
- **Missing Google name or photo.** Name falls back to "Movie fan", the avatar falls back to an initial, email is hidden if absent.
- **Headers.** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, no `X-Powered-By`. Fact responses are `Cache-Control: private, no-store`.

### Testing

The fact service takes its storage and OpenAI call as parameters, so tests run it against an in-memory store that enforces the same unique key as Postgres, with a fake clock.

- **Cache logic:** first request generates; at 59.999 s the cached fact is returned; at exactly 60 s a new one is generated; the newest of several facts is chosen.
- **Burst protection:** 5 concurrent requests produce 1 OpenAI call, 1 row, and the same fact for all 5.
- **Failure handling:** fallback to the cached fact, friendly error when nothing is cached, claim released after a failure, waiting on a stuck claim times out.
- **Authorization:** a user never receives another user's fact (not from the cache and not as a fallback); another user's claim doesn't block you; the API returns 401 when signed out and only ever asks for the session user's id.
- **Validation:** trimming, min/max length, control characters, non-string input.

---

## Why Variant A

The interesting problems in this app are on the backend: deciding when a fact can be reused, making sure several tabs don't trigger several paid API calls, and keeping the user experience intact when OpenAI fails. Those are correctness problems that can be tested precisely, and they matter more for real cost and reliability than client-side polish does. Variant A also let me lean on the database for guarantees instead of hoping requests don't race.

## Key tradeoffs

- **Unique constraint instead of an in-memory lock.** An in-memory lock only works inside one Node process. On serverless or with more than one instance, two requests on different machines would both generate. The unique constraint is enforced by Postgres, so it holds everywhere, at the cost of one extra insert per generation.
- **Claim before calling OpenAI (insert PENDING, then fill in).** The simpler version (call OpenAI, then insert) still keeps one row per window, but every racing request would already have paid for an OpenAI call. Claiming first means losers never call OpenAI. The cost is a `PENDING` state and the cleanup rules above.
- **Losers wait (poll) rather than return the old fact immediately.** All tabs end up showing the same new fact. The cost is that a waiting request holds a connection for up to a few seconds. Polling at 250 ms keeps this cheap; Postgres `LISTEN/NOTIFY` would avoid polling but adds complexity that isn't justified here.
- **Fixed 60 s windows in the unique key vs. the sliding 60 s TTL.** The TTL is what users see; the window is only for deduplication. As explained above they never conflict.
- **Database sessions instead of JWT.** One extra indexed query per request, in exchange for real logout and revocation.
- **Fact loaded by the client after the page renders.** The dashboard appears instantly even if OpenAI is slow, and `/api/fact` is the single, testable entry point for facts. The tradeoff is a brief loading state.
- **History is kept.** At most one row per user per minute. Fine at this scale; a retention job would be needed at large scale.
- **App clock, not DB clock.** `createdAt` and `cacheWindow` come from the same `Date.now()` so they always agree. With several servers, small clock differences between machines could shift a window boundary by a few milliseconds. The unique constraint still guarantees no duplicates, so the worst case is a cache entry living a few milliseconds longer or shorter.

## What I would improve with 2 more hours

1. Integration tests against a real Postgres (Testcontainers) for `prisma-store.ts`, plus an end-to-end Playwright test of the sign-in, onboarding and dashboard flow with a mocked Google provider.
2. Treat `PENDING` rows older than the OpenAI timeout as abandoned, so a crashed request never makes others wait the full 11 s.
3. Per-user rate limiting on `/api/fact` (the cache already limits OpenAI to one call per user per minute, but polling requests still reach the DB).
4. Let users change their favorite movie from the dashboard (the schema already supports it).
5. Structured logging and metrics for cache hit rate, OpenAI latency and failures.
6. A Content Security Policy with nonces.

## AI usage

- Used Claude (Anthropic) to turn the assignment spec into an implementation plan and to draft the code, tests and this README.
- Used it to reason through the concurrency design (claim-first with a unique constraint vs. an in-memory lock) and the edge cases around the 60 second window.
- Used it to check behavior against a local Postgres: concurrent requests, fallback paths, and the Auth.js adapter with this schema.
