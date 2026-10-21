import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The app version is `MAJOR.MINOR.BUILD`: MAJOR.MINOR from package.json, BUILD = number of commits on the branch (every push is a new one;
 * the release workflow checks out the whole history). `APP_BUILD` overrides it, a build without git says `0`.
 */
function buildInfo() {
  const git = (command: string) => { try { return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  const build = (process.env.APP_BUILD || git("git rev-list --count HEAD") || "0").replace(/\D/g, "") || "0";
  const [major, minor] = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string).split(".");
  return { version: `${major}.${minor}.${build}`, build, sha: git("git rev-parse --short HEAD") || "" };
}
const info = buildInfo();

/** `/version.json` next to the pages: what a running app compares itself with. */
function versionFile(): Plugin {
  return {
    name: "app-version-file",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ ...info, builtAt: new Date().toISOString() }) });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    versionFile(),
    cloudflare({
      viteEnvironment: { name: "flyer_map" },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(info.version),
    __APP_BUILD__: JSON.stringify(info.build),
    __APP_SHA__: JSON.stringify(info.sha),
  },
  build: {
    sourcemap: true,
  },
  environments: {
    // v5 field core ships as a second page next to the existing app (served at /v5).
    client: { build: { rollupOptions: { input: { main: "index.html", v5: "v5.html" } } } },
  },
});
