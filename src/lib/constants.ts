/** Cookie holding the customer's chosen locality slug (non-sensitive; httpOnly). */
export const LOCALITY_COOKIE = "nx_locality";

/**
 * Cookie holding a position the visitor CHOSE to share ("Use my location"), as "lat,lng"
 * rounded to ~100 m. Set by the browser, read by the server for distance only, expires
 * after 2 hours, and is never written to the database.
 */
export const NEAR_COOKIE = "nx_near";
export const NEAR_COOKIE_MAX_AGE_S = 2 * 60 * 60;
