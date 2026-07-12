import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "src/generated/prisma/**",
    "next-env.d.ts",
    ".tmp-*/**",
    "scaffold-nextbuf-temp/**",
    "UI/**",
  ]),
  {
    files: ["src/**/*.client.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["@/infrastructure/*", "@/modules/*", "@/worker/*", "@/shared/config/*"],
        },
      ],
    },
  },
]);

export default eslintConfig;
