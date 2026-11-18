const BLOCKED_PAIR_TAGS = [
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "form",
  "textarea",
  "select",
  "button",
];

const BLOCKED_VOID_TAGS = ["input", "meta", "link", "base", "source", "track"];

const stripAsciiControlsAndSpaces = (value: string): string => {
  let result = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) continue;
    result += value[i]!;
  }
  return result;
};

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const escapeAttr = (value: string): string => escapeHtml(value);

export const sanitizeHref = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#")) return trimmed;
  const compact = stripAsciiControlsAndSpaces(trimmed);
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
  if (!schemeMatch) {
    return trimmed.startsWith("//") ? "" : trimmed;
  }
  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme === "http" || scheme === "https" || scheme === "mailto") {
    return trimmed;
  }
  return "";
};

export const sanitizeImageSrc = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const compact = stripAsciiControlsAndSpaces(trimmed);
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
  if (!schemeMatch) {
    return trimmed.startsWith("//") ? "" : trimmed;
  }
  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme === "http" || scheme === "https" || scheme === "blob") {
    return trimmed;
  }
  return "";
};

const URL_ATTRS = new Set(["href", "src", "poster", "action", "formaction", "xlink:href"]);

const sanitizeTagAttributes = (tagName: string, rawAttrs: string): string => {
  const kept: string[] = [];
  const attrPattern = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rawAttrs)) !== null) {
    const attrName = match[1]!.toLowerCase();
    const attrValue = match[2] ?? match[3] ?? match[4] ?? "";
    // Never allow inline event handlers, inline style, srcdoc, or native HTML title attributes.
    if (
      attrName.startsWith("on")
      || attrName === "style"
      || attrName === "srcdoc"
      || attrName === "title"
    ) {
      continue;
    }
    if (URL_ATTRS.has(attrName)) {
      const safeUrl = attrName === "src" || attrName === "poster"
        ? sanitizeImageSrc(attrValue)
        : sanitizeHref(attrValue);
      if (!safeUrl) continue;
      kept.push(`${attrName}="${escapeAttr(safeUrl)}"`);
      continue;
    }
    if (tagName === "a" && attrName === "target" && attrValue.toLowerCase() === "_blank") {
      kept.push('target="_blank" rel="noopener noreferrer"');
      continue;
    }
    if (attrName === "rel" && tagName === "a") {
      continue;
    }
    if (match[2] === undefined && match[3] === undefined && match[4] === undefined) {
      kept.push(attrName);
    } else {
      kept.push(`${attrName}="${escapeAttr(attrValue)}"`);
    }
  }
  return kept.length ? ` ${kept.join(" ")}` : "";
};

export const sanitizeRawHtml = (rawHtml: string): string => {
  let cleaned = rawHtml.replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of BLOCKED_PAIR_TAGS) {
    const pairPattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const openOnlyPattern = new RegExp(`<\\/?${tag}\\b[^>]*\\/?>`, "gi");
    cleaned = cleaned.replace(pairPattern, "").replace(openOnlyPattern, "");
  }

  for (const tag of BLOCKED_VOID_TAGS) {
    const voidPattern = new RegExp(`<\\/?${tag}\\b[^>]*\\/?>`, "gi");
    cleaned = cleaned.replace(voidPattern, "");
  }

  return cleaned.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)(\/?)>/g,
    (_full, slash: string, rawTagName: string, attrs: string, selfClose: string) => {
      const tagName = rawTagName.toLowerCase();
      if (slash) {
        return `</${tagName}>`;
      }
      const safeAttrs = sanitizeTagAttributes(tagName, attrs);
      return `<${tagName}${safeAttrs}${selfClose ? " /" : ""}>`;
    },
  );
};
