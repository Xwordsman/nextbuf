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
          patterns: [
            {
              group: ["@/infrastructure/*", "@/infrastructure/**"],
              message: "Client Components must not import infrastructure code.",
            },
            {
              group: ["@/modules/*", "@/modules/**"],
              allowTypeImports: true,
              message: "Client Components may import only module-owned public types.",
            },
            {
              group: ["@/worker/*", "@/worker/**"],
              message: "Client Components must not import worker code.",
            },
            {
              group: ["@/shared/config/*", "@/shared/config/**"],
              message: "Client Components must not import server configuration.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
