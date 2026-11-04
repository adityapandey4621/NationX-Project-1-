import type { NearMeLabels } from "@/components/marketplace/near-me";
import type { Translate } from "./translate";

export function nearMeLabels(t: Translate): NearMeLabels {
  return {
    use: t("near.use"),
    asking: t("near.asking"),
    hint: t("near.hint"),
    denied: t("near.denied"),
    unavailable: t("near.unavailable"),
    active: t("near.active"),
    stop: t("near.stop"),
  };
}