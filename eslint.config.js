import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    /* Playwright specs and its config run in Node, not the browser. Code inside
       page.evaluate() is browser code, so both global sets are needed here. */
    files: ["e2e/**/*.js", "playwright.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    /* Build tooling: the Vite config (including the dev-only Pexels proxy
       middleware) and the release scripts are Node programs. */
    files: ["vite.config.js", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "public/**", "test-results/**", "playwright-report/**"],
  },
];
