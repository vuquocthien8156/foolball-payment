import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // Always try to get the freshest version from the network first.
        // If the network is unavailable, fall back to the cached version.
        // This is ideal for apps that are frequently updated.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "navigation-cache",
            },
          },
        ],
      },
      strategies: "injectManifest",
      srcDir: "public",
      filename: "sw.js",
      devOptions: {
        enabled: true,
      },
      includeAssets: [
        "favicon.ico",
        "robots.txt",
        "pwa-192x192.png",
        "pwa-512x512.png",
      ],
      manifest: {
        name: "Chia tiền sân",
        short_name: "Chia tiền",
        description: "Ứng dụng chia tiền sân bóng đá",
        theme_color: "#18181b",
        background_color: "#18181b",
        display: "standalone",
        scope: "/",
        start_url: "/pay",
        id: "/pay",
        orientation: "portrait-primary",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
