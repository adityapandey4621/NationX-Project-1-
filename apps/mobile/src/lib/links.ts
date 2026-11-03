import { Alert, Linking, Share } from "react-native";
import type { PublicShop } from "./types";
import { shopWebUrl, whatsappDigits } from "./format";

export async function openLink(url: string, failMessage: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Could not open", failMessage);
  }
}

export const callShop = (phone: string) => openLink(`tel:${phone}`, "This device cannot place calls.");

export function whatsappShop(raw: string | null) {
  const d = whatsappDigits(raw);
  return d ? openLink(`https://wa.me/${d}`, "WhatsApp is not available.") : Promise.resolve();
}

export function directionsUrl(shop: PublicShop): string {
  const dest =
    shop.latitude != null && shop.longitude != null
      ? `${shop.latitude},${shop.longitude}`
      : encodeURIComponent([shop.address_line, shop.locality.name, shop.pincode ?? shop.locality.pincode].filter(Boolean).join(", "));
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

/** Shares the public storefront link (it opens this app if installed, otherwise the website). */
export async function shareShop(webUrl: string, slug: string, name: string): Promise<void> {
  const url = shopWebUrl(webUrl, slug);
  try {
    await Share.share({ message: `${name} on NationX: ${url}`, url });
  } catch {
    /* user dismissed or share unavailable */
  }
}