import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SETTING_KEY_PATTERN = /^[a-z][a-z0-9._-]*$/;

const ALLOWED_PERMISSIONS = new Set([
  "notes:read",
  "notes:write",
  "notes:delete",
  "metadata:read",
  "metadata:write",
  "resources:read",
  "resources:write",
  "templates:read",
  "templates:write",
  "network",
  "network:public",
  "ai:generate",
  "storage",
  "secrets",
  "schedules",
  "editor:read",
  "editor:write",
  "ui:commands",
  "ui:navigation",
  "ui:notices",
  "ui:panels",
  "ui:embeds",
]);

const validateManifest = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("manifest.json must be a JSON object.");
  }
  if (raw.type !== "plugin") throw new Error('manifest.json must declare type="plugin".');
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
    throw new Error("manifest.json id must be a valid reverse-domain identifier.");
  }
  if (raw.id === "org.edgeever" || raw.id.startsWith("org.edgeever.")) {
    throw new Error(`Plugin id ${raw.id} uses the reserved org.edgeever.* namespace.`);
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) throw new Error("manifest.json name is required.");
  if (typeof raw.version !== "string" || !VERSION_PATTERN.test(raw.version)) {
    throw new Error("manifest.json version must be SemVer.");
  }
  if (raw.apiVersion !== "2") throw new Error('manifest.json apiVersion must be "2".');
  if (raw.settingsUi !== "host") throw new Error('manifest.json settingsUi must be "host".');
  if (raw.entry !== "./main.js") throw new Error('manifest.json entry must be "./main.js".');
  if (Array.isArray(raw.permissions)) {
    for (const permission of raw.permissions) {
      if (!ALLOWED_PERMISSIONS.has(String(permission))) {
        throw new Error(`Unsupported permission in manifest.json: ${String(permission)}`);
      }
    }
  }
  if (raw.settings !== undefined) {
    if (!raw.settings || typeof raw.settings !== "object" || !Array.isArray(raw.settings.fields)) {
      throw new Error("manifest.json settings.fields must be an array.");
    }
    if (raw.settings.fields.length > 50) {
      throw new Error("manifest.json cannot declare more than 50 settings.");
    }
    const keys = new Set();
    for (const field of raw.settings.fields) {
      if (!field || typeof field.key !== "string" || !SETTING_KEY_PATTERN.test(field.key)) {
        throw new Error(`Invalid setting key: ${String(field?.key)}`);
      }
      if (keys.has(field.key)) throw new Error(`Duplicate setting key: ${field.key}`);
      keys.add(field.key);
    }
  }
  return raw;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(scriptDir, "..");
const distDir = resolve(pluginRoot, "dist");
const monorepoExtensionsDir = resolve(pluginRoot, "../../apps/web/public/extensions");
const publicDir = existsSync(monorepoExtensionsDir)
  ? resolve(monorepoExtensionsDir, "flavored-markdown")
  : null;

const manifestRaw = await readFile(resolve(pluginRoot, "manifest.json"), "utf8");
const parsedManifest = validateManifest(JSON.parse(manifestRaw));
const stylesRaw = await readFile(resolve(pluginRoot, "styles.css"), "utf8");

await mkdir(distDir, { recursive: true });
if (publicDir) {
  await mkdir(publicDir, { recursive: true });
}

const buildResult = await Bun.build({
  entrypoints: [resolve(pluginRoot, "src/main.ts")],
  outdir: distDir,
  target: "browser",
  format: "esm",
  minify: false,
  naming: "main.js",
});

if (!buildResult.success) {
  for (const log of buildResult.logs) {
    console.error(log);
  }
  throw new Error("Failed to bundle flavored-markdown plugin.");
}

const mainRaw = await readFile(resolve(distDir, "main.js"), "utf8");

const encoder = new TextEncoder();
const manifestBytes = encoder.encode(manifestRaw).byteLength;
const mainBytes = encoder.encode(mainRaw).byteLength;
const stylesBytes = encoder.encode(stylesRaw).byteLength;

if (manifestBytes > 256 * 1024) {
  throw new Error(`manifest.json exceeds 256 KiB (${manifestBytes} bytes).`);
}
if (mainBytes > 5 * 1024 * 1024) {
  throw new Error(`main.js exceeds 5 MiB (${mainBytes} bytes).`);
}
if (stylesBytes > 1024 * 1024) {
  throw new Error(`styles.css exceeds 1 MiB (${stylesBytes} bytes).`);
}

if (/<[a-z][a-z0-9-]*\b[^>]*\btitle\s*=/i.test(mainRaw)) {
  throw new Error("Rendered HTML in main.js must not emit native HTML title attributes.");
}

const writes = [
  writeFile(resolve(distDir, "manifest.json"), manifestRaw, "utf8"),
  writeFile(resolve(distDir, "styles.css"), stylesRaw, "utf8"),
];
const outputs = [distDir];

if (publicDir) {
  writes.push(
    writeFile(resolve(publicDir, "manifest.json"), manifestRaw, "utf8"),
    writeFile(resolve(publicDir, "main.js"), mainRaw, "utf8"),
    writeFile(resolve(publicDir, "styles.css"), stylesRaw, "utf8"),
  );
  outputs.push(publicDir);
}

await Promise.all(writes);

console.log(
  JSON.stringify({
    ok: true,
    id: parsedManifest.id,
    version: parsedManifest.version,
    bytes: {
      manifestJson: manifestBytes,
      mainJs: mainBytes,
      stylesCss: stylesBytes,
    },
    outputs,
  }),
);
