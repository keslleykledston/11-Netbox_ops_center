import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const SNMP_SERVER_URL = env.SNMP_SERVER_URL || "http://localhost:3001";
  const API_SERVER_URL = env.API_SERVER_URL || "http://localhost:4000";
  return ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api/snmp": {
        target: SNMP_SERVER_URL,
        changeOrigin: true,
      },
      "/api": {
        target: API_SERVER_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  });
});
