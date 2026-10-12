/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.tsx"],
  moduleNameMapper: {
    // The Open Wearables SDK is not on npm yet; tests always use the stub (see metro.config.js).
    "^open-wearables$": "<rootDir>/src/lib/health/ow-sdk-stub.ts",
  },
  testPathIgnorePatterns: ["/node_modules/", "/.expo/", "/android/", "/ios/"],
  clearMocks: true,
};
