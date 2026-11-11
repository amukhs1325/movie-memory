// Kept separate from validation.ts so client code can import the limits
// without pulling zod into the browser bundle.
export const MOVIE_MIN_LENGTH = 1; // real titles can be one character, e.g. "M" (1931)
export const MOVIE_MAX_LENGTH = 100; // matches VarChar(100) in the Prisma schema
