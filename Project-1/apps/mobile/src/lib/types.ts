/**
 * Response shapes of the /api/v1 endpoints the app uses (snake_case, see docs/API_CONTRACTS.md).
 * They describe what the server sends; the server (Zod) remains the authority on validity.
 */
export type UserRole = "customer" | "merchant" | "admin" | "operator";
export type StockLabel = "in_stock" | "call_to_confirm" | "out_of_stock";
export type OperatingModel = "delivery" | "pickup" | "visit_only" | "appointment" | "quotation";
export type HelpStatus = "pending" | "under_review" | "matched" | "unresolved" | "cancelled";
export type ApplicationStatus = "draft" | "submitted" | "correction_requested" | "approved" | "rejected" | "suspended";

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  preferred_language: "en" | "te";
  is_active: boolean;
}
export interface Me {
  profile: Profile;
  roles: UserRole[];
}

export interface Category { id: string; name: string; slug: string; display_order: number }
export interface Locality { id: string; name: string; slug: string; district: string; pincode: string }
export interface Taxonomy { categories: Category[]; localities: Locality[] }

export interface ShopResult {
  type?: "shop";
  storefront_id: string;
  slug: string;
  shop_id: string;
  shop_name: string;
  headline: string | null;
  snippet: string | null;
  logo_url: string | null;
  category_name: string;
  category_slug: string;
  locality_name: string;
  locality_slug: string;
  operating_models: OperatingModel[];
}
export interface ProductResult {
  type?: "product";
  product_id: string;
  name: string;
  name_te: string | null;
  unit: string | null;
  price: number | null;
  mrp: number | null;
  image_url: string | null;
  effective_stock_status: StockLabel;
  shop_name: string;
  storefront_slug: string;
  locality_name: string;
  locality_slug: string;
  category_name: string;
}
export interface Page<T> { query?: string; total: number; limit: number; offset: number; results: T[] }

export interface Homepage {
  categories: (Category & { shop_count: number })[];
  localities: (Locality & { shop_count: number })[];
  featured_shops: ShopResult[];
  active_modules: Record<string, boolean>;
}

export interface OperatingHours { opens: string; closes: string; closed_days: string[] }
export interface PublicShop {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  address_line: string;
  landmark: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  operating_models: OperatingModel[];
  operating_hours: OperatingHours;
  locality: { name: string; slug: string; pincode: string };
  category: { name: string; slug: string };
}
export interface Product {
  id: string;
  shop_id: string;
  name: string;
  name_te: string | null;
  description: string | null;
  price: number | null;
  mrp: number | null;
  unit: string | null;
  stock_status: StockLabel;
  stock_confirmed_at: string | null;
  /** What customers see: stale or unconfirmed stock arrives as call_to_confirm. */
  effective_stock_status: StockLabel;
  image_url: string | null;
  is_published: boolean;
}
export interface StorefrontView {
  storefront: {
    id: string;
    slug: string;
    headline: string | null;
    description: string | null;
    logo_url: string | null;
    banner_url: string | null;
    gallery_urls: string[];
    supported_actions: string[];
  };
  shop: PublicShop;
  products: Product[];
}

export interface HelpRequest {
  id: string;
  tracking_id: string;
  item_name: string;
  item_description: string | null;
  status: HelpStatus;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
  locality: { name: string } | null;
  matched_shop: { name: string; storefront: { slug: string } | null } | null;
}
export interface TrackedRequest {
  tracking_id: string;
  status: HelpStatus;
  item_name: string;
  created_at: string;
  updated_at: string;
  resolution_notes: string | null;
  matched_shop_slug: string | null;
}

export interface Application {
  id: string;
  business_name: string;
  status: ApplicationStatus;
  rejection_reason: string | null;
  correction_notes: string | null;
  associated_business_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManagedStorefront {
  id: string;
  slug: string;
  headline: string | null;
  description: string | null;
  visibility_status: "visible" | "hidden" | "suspended";
  visibility_reason: string | null;
  is_published: boolean;
}
export interface ManagedShop {
  id: string;
  name: string;
  phone: string;
  whatsapp: string | null;
  address_line: string;
  landmark: string | null;
  pincode: string | null;
  operating_models: OperatingModel[];
  operating_hours: OperatingHours;
  locality: { name: string };
  category: { name: string };
  storefront: ManagedStorefront | null;
}
export interface MyBusiness {
  role: "owner" | "manager" | "employee";
  business: { id: string; name: string; shops: ManagedShop[] };
}