import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/examples")) return "three-extras";
          if (id.includes("node_modules/three")) return "three-core";
          if (id.includes("node_modules/gsap")) return "motion";
          return undefined;
        },
      },
    },
  },
  server: {
    allowedHosts: [".lhr.life", ".trycloudflare.com"],
  },
  preview: {
    allowedHosts: [".lhr.life", ".trycloudflare.com"],
  },
});
