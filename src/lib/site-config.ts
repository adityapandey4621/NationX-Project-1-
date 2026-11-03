/**
 * Optional public contact, legal and social details, read from NEXT_PUBLIC_* variables
 * (see .env.example). Nothing is invented: a link or contact line appears in the footer
 * only when the corresponding variable is set.
 */
function clean(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Only http(s) URLs are accepted, so a misconfigured value can never become a javascript: link. */
function url(value: string | undefined): string | null {
  const v = clean(value);
  return v && /^https?:\/\//i.test(v) ? v : null;
}

export const siteConfig = {
  name: "NationX",
  region: "Khammam, Telangana",
  contactEmail: clean(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
  contactPhone: clean(process.env.NEXT_PUBLIC_CONTACT_PHONE),
  privacyUrl: url(process.env.NEXT_PUBLIC_PRIVACY_URL),
  /** Native app downloads: a button appears only when the matching link is configured (https only). */
  androidApkUrl: url(process.env.NEXT_PUBLIC_ANDROID_APK_URL),
  playStoreUrl: url(process.env.NEXT_PUBLIC_PLAY_STORE_URL),
  appStoreUrl: url(process.env.NEXT_PUBLIC_APP_STORE_URL),
  termsUrl: url(process.env.NEXT_PUBLIC_TERMS_URL),
  social: [
    { label: "Instagram", href: url(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM) },
    { label: "Facebook", href: url(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK) },
    { label: "X", href: url(process.env.NEXT_PUBLIC_SOCIAL_X) },
    { label: "YouTube", href: url(process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE) },
    { label: "WhatsApp", href: url(process.env.NEXT_PUBLIC_SOCIAL_WHATSAPP) },
  ].filter((s): s is { label: string; href: string } => s.href !== null),
} as const;
