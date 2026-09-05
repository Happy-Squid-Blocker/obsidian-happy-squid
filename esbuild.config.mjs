import esbuild from "esbuild";
import { builtinModules } from "node:module";
import process from "node:process";

const production = process.argv[2] === "production";

// Obsidian supplies these at runtime; bundling them would ship a second copy of
// the editor and break instanceof checks against the host's own CodeMirror.
const external = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external,
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "main.js",
  platform: "browser",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
