import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readWorkbenchConfig(): Record<string, string> {
  const path = resolve(__dirname, "../config/workbench.env");
  try {
    return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
    }));
  } catch {
    return {};
  }
}

export default defineConfig(({ mode }) => {
  const env = { ...readWorkbenchConfig(), ...loadEnv(mode, "..", ""), ...process.env };
  const backendPort = env.DUCKDB_TOOLS_BACKEND_PORT || "8000";
  const frontendPort = Number(env.DUCKDB_TOOLS_FRONTEND_PORT || "5173");
  const host = env.DUCKDB_TOOLS_HOST || "0.0.0.0";
  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      host,
      proxy: {
        "/api": `http://127.0.0.1:${backendPort}`,
      },
    },
  };
});
