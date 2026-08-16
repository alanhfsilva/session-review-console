import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Next keeps `jsx: preserve` in tsconfig for its own compiler, so the test
  // runner needs its own JSX transform.
  plugins: [react()],
  // API and domain tests run in node; component tests opt into jsdom with a
  // `@vitest-environment` comment at the top of the file.
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});
