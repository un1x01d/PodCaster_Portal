import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": {
        target: "http://backend:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, "")
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const groups = [
            ["xlsx", ["xlsx"]],
            ["jspdf", ["jspdf", "jspdf-autotable"]],
            ["recharts", ["recharts"]],
            ["vendor", ["react", "react-dom", "react-router-dom", "axios"]]
          ];
          for (const [chunkName, packages] of groups) {
            if (packages.some((pkg) => id.includes(`/node_modules/${pkg}/`))) {
              return chunkName;
            }
          }
          return undefined;
        }
      }
    }
  },
  optimizeDeps: {
    include: ["react-window", "react-virtualized-auto-sizer"]
  }
});
