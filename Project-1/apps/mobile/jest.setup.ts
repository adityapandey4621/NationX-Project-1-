import "react-native-url-polyfill/auto";

// Native modules that do not exist in the Jest (Node) environment.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined), fetch: jest.fn(async () => ({ isConnected: true })) },
  addEventListener: jest.fn(() => () => undefined),
  useNetInfo: jest.fn(() => ({ isConnected: true, isInternetReachable: true })),
}));