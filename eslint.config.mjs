import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "generated/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Unused things are mistakes, except an underscore prefix says "on purpose".
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Remote avatars are tiny and already sized by Discord's CDN; next/image would add a proxy and a CSP entry for nothing.
      "@next/next/no-img-element": "off",
      // Apostrophes in ordinary sentences are harmless; escaping each one makes copy harder to read.
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default config;
