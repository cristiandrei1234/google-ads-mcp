import dotenv from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Shared by the server and token utilities: never depend on the launcher's cwd. */
export function resolveEnvFile(): string {
  const projectEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
  const explicit = process.env.GOOGLE_ADS_MCP_ENV;
  if (explicit) return explicit;
  const userEnv = path.join(os.homedir(), ".config", "google-ads-mcp", ".env");
  return fs.existsSync(userEnv) ? userEnv : projectEnv;
}

export function loadEnvironment(): string {
  const file = resolveEnvFile();
  // Launcher-injected variables take precedence. Keep stdout clean for stdio MCP.
  if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
  return file;
}
