import { getT } from "@/i18n/server";
import { SearchBox } from "@/components/marketplace/search-box";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { MODEL_LABELS } from "@/components/discovery/shop-card";
import type { Category, Locality } from "@/server/validation";

interface SearchFormProps {
  /** Page the form submits to (GET). */
  action: string;
  categories: Category[];
  localities: Locality[];
  values: { q?: string | undefined; category?: string | undefined; locality?: string | undefined; model?: string | undefined; sort?: string | undefined };
  /** Hide a filter that is fixed by the page (e.g. category on /category/kirana). */
  hide?: { category?: boolean; locality?: boolean };
  /** True when the visitor shared a position, which unlocks the "Nearest" sort. */
  canSortNearest?: boolean;
}

const label = "space-y-1 text-xs font-medium text-muted-foreground";

/**
 * Search box (with typeahead) plus filters, as one plain GET form: it works without
 * JavaScript and produces shareable URLs. "All areas" is sent as `locality=all` so it
 * can override a remembered area.
 */
export async function SearchForm({ action, categories, localities, values, hide, canSortNearest }: SearchFormProps) {
  const t = await getT();
  return (
    <SearchBox primary action={action} defaultValue={values.q ?? ""} placeholder={t("search.placeholderLong")} buttonLabel={t("search.button")}>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(4,1fr)_auto] lg:items-end">
        {hide?.category ? null : (
          <label className={label}>
            Category
            <NativeSelect name="category" defaultValue={values.category ?? ""}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {hide?.locality ? null : (
          <label className={label}>
            Area
            <NativeSelect name="locality" defaultValue={values.locality ?? ""}>
              <option value="all">All areas</option>
              {localities.map((l) => (
                <option key={l.id} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <label className={label}>
          How you shop
          <NativeSelect name="model" defaultValue={values.model ?? ""}>
            <option value="">Any</option>
            {Object.entries(MODEL_LABELS).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className={label}>
          Sort by
          <NativeSelect name="sort" defaultValue={values.sort ?? (canSortNearest ? "nearest" : "relevance")}>
            {canSortNearest ? <option value="nearest">Nearest first</option> : null}
            <option value="relevance">Best match</option>
            <option value="newest">Newest</option>
            <option value="name">Name (A–Z)</option>
          </NativeSelect>
        </label>
        <Button type="submit" variant="secondary" size="lg" className="col-span-2 sm:col-span-1">
          Apply filters
        </Button>
      </div>
    </SearchBox>
  );
}
