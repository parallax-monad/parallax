import { z } from "zod";

const quoteFetchedAtSchema = z.string().datetime();

/** Return quote acquisition time only when it matches the public ISO datetime contract. */
export function validatedQuoteFetchedAt(value: unknown): string | undefined {
  const parsed = quoteFetchedAtSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
