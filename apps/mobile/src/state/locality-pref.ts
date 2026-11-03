import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

const KEY = "nx_locality";

/** The customer's chosen area slug. Not sensitive, so plain AsyncStorage. */
export function useLocalityPref() {
  const [slug, setSlugState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setSlugState(v))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);
  const setSlug = useCallback((next: string | null) => {
    setSlugState(next);
    (next ? AsyncStorage.setItem(KEY, next) : AsyncStorage.removeItem(KEY)).catch(() => undefined);
  }, []);
  return { slug, setSlug, ready };
}