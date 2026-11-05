import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE_DIR = path.dirname(LIB_DIR);

/**
 * Load a small .env file without adding a dependency. Existing environment
 * variables always win, which is what CI and hosted deployments expect.
 */
export async function loadEnvFile(file = path.join(WEBSITE_DIR, ".env.local")) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { file, loaded: 0 };
  }
  let loaded = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
    loaded += 1;
  }
  return { file, loaded };
}

export { WEBSITE_DIR };
