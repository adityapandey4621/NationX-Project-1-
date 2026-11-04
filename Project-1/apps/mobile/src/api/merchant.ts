import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { keys } from "./queries";
import type { OperatingHours, OperatingModel, StockLabel } from "../lib/types";

export interface ProductBody {
  name: string;
  name_te?: string | null;
  description?: string | null;
  price?: number | null;
  mrp?: number | null;
  unit?: string | null;
  stock_status?: StockLabel;
  is_published?: boolean;
}

/** Every call is authorised by the server (owner/manager of the shop, enforced again by row-level security). */
export function useProductMutations(shopId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.products(shopId) });
    void qc.invalidateQueries({ queryKey: ["public", "shop"] });
  };
  const base = `/merchant/shops/${shopId}/products`;
  return {
    create: useMutation({ mutationFn: (b: ProductBody) => api().post<{ product_id: string }>(base, { json: b }), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: string; body: Partial<ProductBody> }) => api().patch(`${base}/${v.id}`, { json: v.body }), onSuccess: refresh }),
    confirmStock: useMutation({ mutationFn: (id: string) => api().patch(`${base}/${id}`, { json: { confirm_stock: true } }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api().delete(`${base}/${id}`), onSuccess: refresh }),
    uploadImage: useMutation({
      mutationFn: (v: { id: string; uri: string; mimeType?: string | null }) => {
        const form = new FormData();
        // React Native's FormData accepts a { uri, name, type } descriptor for files.
        form.append("file", { uri: v.uri, name: "photo.jpg", type: v.mimeType ?? "image/jpeg" } as unknown as Blob);
        return api().post<{ image_url: string }>(`${base}/${v.id}/image`, { form });
      },
      onSuccess: refresh,
    }),
    removeImage: useMutation({ mutationFn: (id: string) => api().delete(`${base}/${id}/image`), onSuccess: refresh }),
  };
}

export interface ShopPatch {
  phone?: string;
  whatsapp?: string | null;
  address_line?: string;
  landmark?: string | null;
  pincode?: string | null;
  operating_hours?: OperatingHours;
  operating_models?: OperatingModel[];
  headline?: string | null;
  description?: string | null;
}
export function useUpdateShop(shopId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ShopPatch) => api().patch(`/merchant/shops/${shopId}`, { json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.businesses });
      void qc.invalidateQueries({ queryKey: ["public", "shop"] });
    },
  });
}