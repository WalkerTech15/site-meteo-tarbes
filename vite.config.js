import { defineConfig } from "vite";

// The app has no client-side router (views are shown/hidden with JS, not
// URLs), so a relative base lets the same build work unmodified whether it's
// served from a domain root (current Hostinger deploy) or a GitHub Pages
// project path such as /site-meteo-tarbes/.
export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["js/**/*.test.js"],
  },
});
