import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LANG_COOKIE, parseLocale, type Locale } from "./config";
import { createTranslator, type Translate } from "./translate";

/** The visitor's language for this request (cookie), memoised. */
export const getLocale = cache(async (): Promise<Locale> => parseLocale((await cookies()).get(LANG_COOKIE)?.value));

/** `const t = await getT()` in any server component. */
export async function getT(): Promise<Translate> {
  return createTranslator(await getLocale());
}