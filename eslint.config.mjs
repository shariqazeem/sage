import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import eslintConfigPrettier from "eslint-config-prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Disable ESLint formatting rules that would conflict with Prettier.
  eslintConfigPrettier,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      // Foundry project: linted by forge, not the Next app's ESLint. Keeps the
      // vendored OpenZeppelin submodule (contracts/lib/**) out of `npm run lint`.
      "contracts/**",
      // Reference design prototype (`.dc.html` + its framework) extracted into the
      // repo — it's a source-of-truth to port from, not app code we lint/build.
      "Sage Master Design Prompt/**",
    ],
  },
];

export default eslintConfig;
