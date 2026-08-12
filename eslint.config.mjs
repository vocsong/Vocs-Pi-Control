import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "images/base/agent/agent.cjs",
      "**/*.test.ts",
      "**/*.mjs",
      "**/*.cjs",
      "**/scripts/**",
      "**/public/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs["recommended-latest"],
  {
    rules: {
      // Pragmatic monorepo defaults (issue #17). Deliberate relaxations:
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
