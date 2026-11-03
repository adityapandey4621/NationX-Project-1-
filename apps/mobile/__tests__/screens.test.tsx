import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import HelpMeFindIt from "../app/(tabs)/help";
import ShopTab from "../app/(tabs)/shop";
import SignIn from "../app/sign-in";
import { AuthFailure } from "../src/lib/auth";
import { ErrorState } from "../src/components/states";
import { StockBadge } from "../src/components/ui";
import { ApiError } from "../src/lib/api";


const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
  Redirect: () => null,
  Link: () => null,
}));

const mockSignIn = jest.fn();
jest.mock("../src/lib/auth", () => ({ ...jest.requireActual("../src/lib/auth"), signIn: (...a: unknown[]) => mockSignIn(...a) }));

let mockSession: unknown = { status: "signedOut" };
jest.mock("../src/state/session", () => ({ useSession: () => ({ state: mockSession, signOut: jest.fn() }) }));

const mockQuery = (data: unknown) => ({ data, isLoading: false, error: null, refetch: jest.fn(), isRefetching: false });
let mockBusinesses: unknown = [];
let mockApplications: unknown = [];
const mockMutate = jest.fn();
jest.mock("../src/api/queries", () => ({
  useMyBusinesses: () => mockQuery(mockBusinesses),
  useMyApplications: () => mockQuery(mockApplications),
  useTaxonomy: () => mockQuery({ categories: [], localities: [{ id: "l1", name: "Gandhi Chowk", slug: "gandhi-chowk", district: "Khammam", pincode: "507001" }] }),
  useSubmitHelpRequest: () => ({ mutate: mockMutate, isPending: false, error: null, reset: jest.fn() }),
}));
jest.mock("../src/config", () => ({ appConfig: () => ({ webUrl: "https://nationx.test", apiUrl: "https://nationx.test" }), configResult: { ok: true } }));


const show = async (ui: ReactElement) => render(ui);
beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { status: "signedOut" };
  mockBusinesses = [];
  mockApplications = [];
});

describe("SignIn screen", () => {
  it("validates before calling the server", async () => {
    await show(<SignIn />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(screen.getByText("Enter your password")).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("signs in with the same credentials as the website and moves to the account tab", async () => {
    mockSignIn.mockResolvedValue(undefined);
    await show(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "ravi@example.in");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct-horse");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(mockSignIn).toHaveBeenCalledWith("ravi@example.in", "correct-horse");
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/account");
  });

  it("shows a non-leaky failure message and stays on the screen", async () => {
    mockSignIn.mockRejectedValue(new AuthFailure("Incorrect email or password."));
    await show(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText("Email"), "ravi@example.in");
    await fireEvent.changeText(screen.getByLabelText("Password"), "wrong-password");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Incorrect email or password.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("Shop tab is role-aware", () => {
  it("asks a signed-out visitor to sign in and shows no shop data", async () => {
    await show(<ShopTab />);
    expect(screen.getByText("Sell on NationX")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByText("Manage items")).toBeNull();
  });

  it("offers the website application to a signed-in customer with no shop", async () => {
    mockSession = { status: "signedIn", userId: "u", email: "a@b.in", me: { roles: ["customer"] }, meLoading: false, meError: null, reloadMe: jest.fn() };
    await show(<ShopTab />);
    expect(screen.getByText("You haven't listed a shop yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add your shop on the website" })).toBeTruthy();
    expect(screen.queryByText("Manage items")).toBeNull();
  });

  const shop = (role: string) => [{ role, business: { id: "b", name: "Ram & Sons", shops: [{ id: "s1", name: "Sri Ram Kirana", category: { name: "Kirana" }, locality: { name: "Gandhi Chowk" }, storefront: { id: "f", slug: "sri-ram", visibility_status: "visible", visibility_reason: null } }] } }];
  it("gives an owner edit controls", async () => {
    mockSession = { status: "signedIn", userId: "u", email: "a@b.in", me: { roles: ["customer", "merchant"] }, meLoading: false, meError: null, reloadMe: jest.fn() };
    mockBusinesses = shop("owner");
    await show(<ShopTab />);
    expect(screen.getByRole("button", { name: "Manage items" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit shop details" })).toBeTruthy();
  });

  it("gives staff view-only controls", async () => {
    mockSession = { status: "signedIn", userId: "u", email: "a@b.in", me: { roles: ["customer", "merchant"] }, meLoading: false, meError: null, reloadMe: jest.fn() };
    mockBusinesses = shop("employee");
    await show(<ShopTab />);
    expect(screen.getByRole("button", { name: "View items" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage items" })).toBeNull();
  });

  it("tells a merchant when an administrator has taken the page offline, with the reason", async () => {
    mockSession = { status: "signedIn", userId: "u", email: "a@b.in", me: { roles: ["customer", "merchant"] }, meLoading: false, meError: null, reloadMe: jest.fn() };
    const b = shop("owner") as { business: { shops: { storefront: Record<string, unknown> }[] } }[];
    b[0]!.business.shops[0]!.storefront = { id: "f", slug: "sri-ram", visibility_status: "suspended", visibility_reason: "Complaint under review" };
    mockBusinesses = b;
    await show(<ShopTab />);
    expect(screen.getByText("Your public page is suspended")).toBeTruthy();
    expect(screen.getByText(/Complaint under review/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View public page" })).toBeNull();
  });

  it("shows the status and feedback of an application awaiting changes", async () => {
    mockSession = { status: "signedIn", userId: "u", email: "a@b.in", me: { roles: ["customer"] }, meLoading: false, meError: null, reloadMe: jest.fn() };
    mockApplications = [{ id: "a1", business_name: "Ram Stores", status: "correction_requested", correction_notes: "Upload a clearer photo", rejection_reason: null, updated_at: "2026-11-02T10:00:00+00:00" }];
    await show(<ShopTab />);
    expect(screen.getByText("Changes requested")).toBeTruthy();
    expect(screen.getByText(/Upload a clearer photo/)).toBeTruthy();
  });
});

describe("Help Me Find It form", () => {
  it("does not send an incomplete request", async () => {
    await show(<HelpMeFindIt />);
    await fireEvent.press(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByText("Tell us what you are looking for")).toBeTruthy();
    expect(screen.getByText("Choose your area")).toBeTruthy();
    expect(screen.getByText("Please agree to be contacted about this request")).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("sends a normalised request once complete", async () => {
    await show(<HelpMeFindIt />);
    await fireEvent.changeText(screen.getByLabelText("What are you looking for?"), "Wood-pressed sesame oil");
    await fireEvent.press(screen.getByRole("button", { name: "Gandhi Chowk" }));
    await fireEvent.changeText(screen.getByLabelText("Your name"), "Venkatesh");
    await fireEvent.changeText(screen.getByLabelText("Mobile number"), "98480 12345");
    await fireEvent(screen.getByLabelText("I agree to be contacted about this request"), "valueChange", true);
    await fireEvent.press(screen.getByRole("button", { name: "Send request" }));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]![0]).toMatchObject({ item_name: "Wood-pressed sesame oil", preferred_locality_id: "l1", contact_phone: "+919848012345", consent_given: true });
  });
});

describe("shared states", () => {
  it("StockBadge uses the three honest labels", async () => {
    await show(<StockBadge status="call_to_confirm" />);
    expect(screen.getByText("Call to confirm")).toBeTruthy();
  });
  it("offline errors say so and offer retry", async () => {
    const retry = jest.fn();
    await show(<ErrorState error={new ApiError("NETWORK", "offline")} onRetry={retry} />);
    expect(screen.getByText("You're offline")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
  it("a refused request offers no pointless retry", async () => {
    await show(<ErrorState error={new ApiError("FORBIDDEN", "Only owners can do that", 403)} onRetry={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});