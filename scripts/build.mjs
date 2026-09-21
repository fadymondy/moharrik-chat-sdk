// Build dist/: ESM + CJS for npm, an IIFE bundle for the <script> tag, and types.
//
// esbuild + tsc directly rather than a meta-bundler: this package is a handful
// of files with no dependencies, and two small tools that do exactly one thing
// each are easier to reason about than a config file that hides both.
//
//   node scripts/build.mjs

import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(import.meta.url)

// require, not import(): esbuild ships CommonJS, and on Windows a bare absolute
// path is not a URL the ESM loader will take.
const esbuild = require(require.resolve("esbuild", { paths: [root] }))

rmSync(path.join(root, "dist"), { recursive: true, force: true })
mkdirSync(path.join(root, "dist"), { recursive: true })

const entry = {
  index: "src/index.ts",
  react: "src/react.tsx",
  vue: "src/vue.ts",
}

const shared = {
  absWorkingDir: root,
  bundle: true,
  sourcemap: true,
  target: ["es2020", "chrome90", "firefox90", "safari15"],
  // React and Vue stay peer dependencies: bundling them would ship a second
  // copy of the framework to anyone importing the wrapper.
  external: ["react", "react-dom", "vue"],
  jsx: "automatic",
  logLevel: "info",
}

// ESM
await esbuild.build({
  ...shared,
  entryPoints: entry,
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".js" },
  splitting: false,
})

// CJS
await esbuild.build({
  ...shared,
  entryPoints: entry,
  format: "cjs",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
})

// The <script> build: self-contained, minified, no imports left.
await esbuild.build({
  ...shared,
  entryPoints: { chat: "src/script-tag.ts" },
  format: "iife",
  minify: true,
  external: [],
  outdir: "dist",
})

// Types. tsc is resolved the same way esbuild is, so a checkout with node_modules
// works and so does this repo built against a sibling install.
const tscBin = require.resolve("typescript/bin/tsc", { paths: [root] })
execFileSync(
  process.execPath,
  [tscBin, "--emitDeclarationOnly", "--declaration", "--outDir", "dist", "--project", "tsconfig.json"],
  { cwd: root, stdio: "inherit" },
)

console.log("\nbuilt dist/: index, react, vue (esm + cjs + d.ts) and chat.js (script tag)")
