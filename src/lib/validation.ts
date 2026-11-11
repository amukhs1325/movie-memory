import { z } from "zod";
import { MOVIE_MAX_LENGTH, MOVIE_MIN_LENGTH } from "./movie-limits";

// Control characters (newline, tab, NUL, etc.) never belong in a title.
const CONTROL_CHARS = /\p{Cc}/u;

/**
 * Server-side validation for the favorite movie.
 * 1. Normalize unicode and collapse runs of whitespace to a single space.
 * 2. Trim.
 * 3. Enforce min/max length and reject control characters.
 */
export const movieTitleSchema = z
  .string({ error: "Please enter a movie title." })
  .transform((value) => value.normalize("NFC").replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(MOVIE_MIN_LENGTH, "Please enter a movie title.")
      .max(
        MOVIE_MAX_LENGTH,
        `Movie titles must be ${MOVIE_MAX_LENGTH} characters or fewer.`,
      )
      .refine((value) => !CONTROL_CHARS.test(value), {
        message: "Movie title contains invalid characters.",
      }),
  );

export type MovieTitle = z.infer<typeof movieTitleSchema>;
