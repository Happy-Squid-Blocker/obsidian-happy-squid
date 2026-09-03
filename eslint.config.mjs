// The Obsidian community directory's own review rules, run locally. This is
// what the directory's scanner checks a release against (its FAQ points here),
// so `npm run lint` is the review before the review. Warnings do not block a
// listing; errors do.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
