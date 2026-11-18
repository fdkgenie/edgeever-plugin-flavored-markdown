import { escapeAttr, escapeHtml, sanitizeHref, sanitizeImageSrc, sanitizeRawHtml } from "./sanitizer.ts";
import {
  DEFAULT_OFM_SETTINGS,
  type BlockEntry,
  type FrontmatterEntry,
  type HeadingEntry,
  type OfmSettings,
  type ParsedOfmDocument,
  type TaskMarker,
  type WikilinkRef,
} from "./types.ts";

export interface OfmParseOptions {
  settings?: Partial<OfmSettings>;
  /** Optional lookup so wikilink classes reflect whether the target note exists. */
  isResolvedLink?: (ref: WikilinkRef) => boolean;
}

interface SourceLine {
  text: string;
  offset: number;
  lineNumber: number;
}

interface ParseContext {
  settings: OfmSettings;
  isResolvedLink?: (ref: WikilinkRef) => boolean;
  headings: HeadingEntry[];
  headingSlugCounts: Map<string, number>;
  blocks: Record<string, BlockEntry>;
  links: WikilinkRef[];
  tasks: TaskMarker[];
  footnoteDefs: Map<string, string>;
  footnoteOrder: string[];
  footnoteRefCounts: Map<string, number>;
  inlineFootnotes: number;
}

const CALLOUT_ALIASES: Record<string, string> = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
};

const CALLOUT_SVG_PATHS: Record<string, string> = {
  note: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  abstract: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 11h8"/><path d="M8 15h6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  tip: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  failure: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  danger: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  example: '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
};

const VOID_HTML_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const HTML_TAG_PATTERN = /^<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*?)?(\/?)>/;
const BLOCK_ID_SUFFIX_PATTERN = /^(.*?)(?:^|[ \t]+)\^([A-Za-z0-9-]+)[ \t]*$/;
const STANDALONE_BLOCK_ID_PATTERN = /^[ \t]*\^([A-Za-z0-9-]+)[ \t]*$/;

export const slugifyHeading = (text: string): string => {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replaceAll(/\[\[([^\]]+)\]\]/g, "$1")
    .replaceAll(/[*_`~=]/g, "")
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replaceAll(/\s+/g, "-");
  return cleaned || "section";
};

const allocateHeadingSlug = (ctx: ParseContext, text: string): string => {
  const base = slugifyHeading(text);
  const count = ctx.headingSlugCounts.get(base) ?? 0;
  ctx.headingSlugCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
};

const splitLinesWithOffsets = (source: string): SourceLine[] => {
  const lines: SourceLine[] = [];
  let lineStart = 0;
  let lineNumber = 1;
  for (let i = 0; i <= source.length; i += 1) {
    if (i === source.length || source[i] === "\n") {
      let text = source.slice(lineStart, i);
      if (text.endsWith("\r")) {
        text = text.slice(0, -1);
      }
      lines.push({ text, offset: lineStart, lineNumber });
      lineStart = i + 1;
      lineNumber += 1;
    }
  }
  return lines;
};

export const splitFrontmatter = (source: string): {
  frontmatter: FrontmatterEntry[];
  body: string;
  bodyOffset: number;
  bodyStartLineIndex: number;
  lines: SourceLine[];
} => {
  const lines = splitLinesWithOffsets(source);
  if (lines.length < 3 || !/^---[ \t]*$/.test(lines[0]!.text)) {
    return { frontmatter: [], body: source, bodyOffset: 0, bodyStartLineIndex: 0, lines };
  }
  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i]!.text)) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    return { frontmatter: [], body: source, bodyOffset: 0, bodyStartLineIndex: 0, lines };
  }

  const entries: FrontmatterEntry[] = [];
  for (let i = 1; i < endIndex; i += 1) {
    const raw = lines[i]!.text;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (kv) {
      entries.push({ key: kv[1]!, value: kv[2]!.trim() });
      continue;
    }
    if (trimmed.startsWith("- ") && entries.length > 0) {
      const last = entries[entries.length - 1]!;
      const item = trimmed.slice(2).trim();
      last.value = last.value ? `${last.value}, ${item}` : item;
    }
  }

  const nextLineIndex = endIndex + 1;
  const bodyOffset = nextLineIndex < lines.length ? lines[nextLineIndex]!.offset : source.length;
  return {
    frontmatter: entries,
    body: source.slice(bodyOffset),
    bodyOffset,
    bodyStartLineIndex: nextLineIndex,
    lines,
  };
};

export const parseWikilinkInner = (rawInner: string, isEmbed: boolean): WikilinkRef => {
  const normalized = rawInner.replaceAll("\\|", "|");
  const segments = normalized.split("|");
  const destinationPart = (segments[0] ?? "").trim();
  const restSegments = segments.slice(1).map((segment) => segment.trim());

  let target = destinationPart;
  let heading: string | undefined;
  let blockId: string | undefined;

  const hashIndex = destinationPart.indexOf("#");
  if (hashIndex !== -1) {
    target = destinationPart.slice(0, hashIndex).trim();
    const fragment = destinationPart.slice(hashIndex + 1).trim();
    if (fragment.startsWith("^")) {
      const candidate = fragment.slice(1).trim();
      if (candidate) blockId = candidate;
    } else if (fragment) {
      heading = fragment;
    }
  }

  let alias: string | undefined;
  let width: number | undefined;
  let height: number | undefined;

  if (isEmbed && restSegments.length > 0) {
    const last = restSegments[restSegments.length - 1]!;
    const dimMatch = /^(\d{1,5})(?:x(\d{1,5}))?$/i.exec(last);
    if (dimMatch) {
      width = Number(dimMatch[1]);
      if (dimMatch[2]) height = Number(dimMatch[2]);
      if (restSegments.length > 1) {
        const joinedAlias = restSegments.slice(0, -1).join("|").trim();
        if (joinedAlias) alias = joinedAlias;
      }
    } else {
      const joinedAlias = restSegments.join("|").trim();
      if (joinedAlias) alias = joinedAlias;
    }
  } else if (restSegments.length > 0) {
    const joinedAlias = restSegments.join("|").trim();
    if (joinedAlias) alias = joinedAlias;
  }

  return {
    raw: `${isEmbed ? "!" : ""}[[${rawInner}]]`,
    isEmbed,
    target,
    ...(heading ? { heading } : {}),
    ...(blockId ? { blockId } : {}),
    ...(alias ? { alias } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
};

export const formatWikilinkLabel = (ref: WikilinkRef): string => {
  if (ref.alias) return ref.alias;
  if (ref.heading) return ref.target ? `${ref.target} > ${ref.heading}` : `#${ref.heading}`;
  if (ref.blockId) return ref.target ? `${ref.target} > ^${ref.blockId}` : `^${ref.blockId}`;
  return ref.target || "Untitled";
};

const renderBlockIdBadge = (blockId: string, ctx: ParseContext): string => {
  if (!ctx.settings.readerShowBlockIds) return "";
  return `<button type="button" class="ofm-block-id" data-ofm-copy-block="${escapeAttr(blockId)}" data-ofm-tooltip="Copy block reference ^${escapeAttr(blockId)}" aria-label="Copy block reference ${escapeAttr(blockId)}">^${escapeHtml(blockId)}</button>`;
};

const stripTrailingBlockId = (
  line: string,
  enabled: boolean,
): { text: string; blockId: string | null } => {
  if (!enabled) return { text: line, blockId: null };
  const match = BLOCK_ID_SUFFIX_PATTERN.exec(line);
  if (!match) return { text: line, blockId: null };
  const body = match[1] ?? "";
  if (/\[\^[^\]]*$/.test(body)) return { text: line, blockId: null };
  return { text: body.trimEnd(), blockId: match[2]! };
};

const registerBlock = (
  ctx: ParseContext,
  blockId: string,
  markdown: string,
  line: number,
) => {
  if (!blockId || Object.hasOwn(ctx.blocks, blockId)) return;
  ctx.blocks[blockId] = { id: blockId, markdown: markdown.trim(), line };
};

const findClosingStrictHtml = (source: string, start: number, tagName: string): number => {
  const lowerTag = tagName.toLowerCase();
  const tagRegex = new RegExp(`<(\\/?)${lowerTag}\\b[^>]*?(\\/?)>`, "gi");
  tagRegex.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(source)) !== null) {
    const isClose = match[1] === "/";
    const isSelfClose = match[2] === "/";
    if (isClose) {
      depth -= 1;
      if (depth <= 0) return match.index + match[0].length;
    } else if (!isSelfClose) {
      depth += 1;
    }
  }
  return -1;
};

const findInlineMathEnd = (source: string, openIndex: number): number => {
  if (openIndex + 1 >= source.length) return -1;
  const nextChar = source[openIndex + 1]!;
  if (nextChar === "$" || /\s/.test(nextChar)) return -1;
  for (let i = openIndex + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "\n") return -1;
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "$") {
      if (source[i + 1] === "$") return -1;
      const prev = source[i - 1]!;
      const after = source[i + 1];
      if (i === openIndex + 1 || /\s/.test(prev) || (after && /[0-9]/.test(after))) {
        return -1;
      }
      return i;
    }
  }
  return -1;
};

const findMatchingParen = (source: string, openParenIndex: number): number => {
  let depth = 1;
  for (let i = openParenIndex + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === "\n") {
      return -1;
    }
  }
  return -1;
};

const parseMarkdownDestination = (
  rawDest: string,
): { url: string; tooltip?: string } => {
  const trimmed = rawDest.trim();
  const titleMatch = /^(.*?)\s+(?:"([^"]*)"|'([^']*)')\s*$/.exec(trimmed);
  let url = (titleMatch ? titleMatch[1]! : trimmed).trim();
  const tooltip = titleMatch ? (titleMatch[2] ?? titleMatch[3] ?? "") : undefined;
  if (url.startsWith("<") && url.endsWith(">")) {
    url = url.slice(1, -1).trim();
  }
  return { url, ...(tooltip ? { tooltip } : {}) };
};

const findClosingDelimiter = (
  source: string,
  start: number,
  delimiter: string,
  requireWordBoundary: boolean,
): number => {
  const len = delimiter.length;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === "`") {
      let tickLen = 1;
      while (source[i + tickLen] === "`") tickLen += 1;
      const closeTick = source.indexOf("`".repeat(tickLen), i + tickLen);
      if (closeTick !== -1) {
        i = closeTick + tickLen - 1;
        continue;
      }
    }
    if (source.startsWith(delimiter, i)) {
      if (len === 1 && source[i + 1] === delimiter && source[i + 2] !== delimiter) {
        if (i > 0 && /\s/.test(source[i - 1]!)) {
          const innerClose = findClosingDelimiter(source, i + 2, delimiter.repeat(2), requireWordBoundary);
          if (innerClose !== -1) {
            i = innerClose + 1;
            continue;
          }
        }
      }
      if (i === start) continue;
      const prev = source[i - 1]!;
      if (/\s/.test(prev)) continue;
      if (requireWordBoundary) {
        const next = source[i + len];
        if (next && /[\p{L}\p{N}]/u.test(next)) continue;
      }
      return i;
    }
  }
  return -1;
};

const renderFootnoteBadge = (id: string, ctx: ParseContext): string => {
  if (!ctx.footnoteOrder.includes(id)) {
    ctx.footnoteOrder.push(id);
  }
  const index = ctx.footnoteOrder.indexOf(id) + 1;
  const seen = (ctx.footnoteRefCounts.get(id) ?? 0) + 1;
  ctx.footnoteRefCounts.set(id, seen);
  const refDomId = `ofm-fnref-${encodeURIComponent(id)}-${seen}`;
  const targetDomId = `ofm-fn-${encodeURIComponent(id)}`;
  return `<sup class="ofm-footnote-ref" id="${escapeAttr(refDomId)}"><a href="#${escapeAttr(targetDomId)}" data-ofm-scroll-id="${escapeAttr(targetDomId)}" aria-label="Footnote ${index}">[${index}]</a></sup>`;
};

export const parseInline = (source: string, ctx: ParseContext): string => {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;

    // 1. Backslash escapes
    if (ch === "\\" && i + 1 < source.length && /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1]!)) {
      out += escapeHtml(source[i + 1]!);
      i += 2;
      continue;
    }

    // 2. Hard line break (2+ trailing spaces or \ before \n)
    if (ch === "\n") {
      if (out.endsWith("  ")) {
        out = `${out.slice(0, -2)}<br />`;
      } else {
        out += "\n";
      }
      i += 1;
      continue;
    }

    // 3. Inline code span
    if (ch === "`") {
      let ticks = 1;
      while (source[i + ticks] === "`") ticks += 1;
      const fence = "`".repeat(ticks);
      const closeIndex = source.indexOf(fence, i + ticks);
      if (closeIndex !== -1) {
        let codeBody = source.slice(i + ticks, closeIndex);
        if (codeBody.length >= 2 && codeBody.startsWith(" ") && codeBody.endsWith(" ") && codeBody.trim().length > 0) {
          codeBody = codeBody.slice(1, -1);
        }
        out += `<code>${escapeHtml(codeBody)}</code>`;
        i = closeIndex + ticks;
        continue;
      }
    }

    // 4. Inline HTML (strict Obsidian rule: do NOT parse Markdown inside HTML elements)
    if (ch === "<") {
      if (source.startsWith("<!--", i)) {
        const endComment = source.indexOf("-->", i + 4);
        if (endComment !== -1) {
          i = endComment + 3;
          continue;
        }
      }
      const angleAutolink = /^<(https?:\/\/[^\s<>]+)>/i.exec(source.slice(i));
      if (angleAutolink) {
        const safeHref = sanitizeHref(angleAutolink[1]!);
        if (safeHref) {
          out += `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(angleAutolink[1]!)}</a>`;
        } else {
          out += escapeHtml(angleAutolink[0]);
        }
        i += angleAutolink[0].length;
        continue;
      }
      const tagMatch = HTML_TAG_PATTERN.exec(source.slice(i));
      if (tagMatch) {
        const tagName = tagMatch[1]!.toLowerCase();
        const isSelfClosing = tagMatch[3] === "/" || VOID_HTML_TAGS.has(tagName);
        if (ctx.settings.syntaxStrictHtml && !isSelfClosing) {
          const endPos = findClosingStrictHtml(source, i, tagName);
          if (endPos !== -1) {
            out += sanitizeRawHtml(source.slice(i, endPos));
            i = endPos;
            continue;
          }
        }
        out += sanitizeRawHtml(tagMatch[0]);
        i += tagMatch[0].length;
        continue;
      }
    }

    // 5. Comments %%...%%
    if (ctx.settings.syntaxComments && source.startsWith("%%", i)) {
      const closeIndex = source.indexOf("%%", i + 2);
      if (closeIndex !== -1) {
        const commentBody = source.slice(i + 2, closeIndex).trim();
        if (ctx.settings.readerShowComments && commentBody) {
          out += `<span class="ofm-comment-badge" aria-label="Obsidian comment">${escapeHtml(commentBody)}</span>`;
        }
        i = closeIndex + 2;
        continue;
      }
    }

    // 6. Inline Math $...$
    if (ctx.settings.syntaxMath && ch === "$" && source[i + 1] !== "$") {
      const closeMath = findInlineMathEnd(source, i);
      if (closeMath !== -1) {
        const latex = source.slice(i + 1, closeMath).trim();
        out += `<span class="ofm-math-inline" data-ofm-latex="${escapeAttr(latex)}">${escapeHtml(latex)}</span>`;
        i = closeMath + 1;
        continue;
      }
    }

    // 7. Embeds ![[...]]
    if (ctx.settings.syntaxEmbeds && source.startsWith("![[", i)) {
      const closeEmbed = source.indexOf("]]", i + 3);
      const newline = source.indexOf("\n", i + 3);
      if (closeEmbed !== -1 && (newline === -1 || closeEmbed < newline)) {
        const inner = source.slice(i + 3, closeEmbed);
        const ref = parseWikilinkInner(inner, true);
        ctx.links.push(ref);
        const payload = escapeAttr(JSON.stringify(ref));
        const label = formatWikilinkLabel(ref);
        out += `<span class="ofm-embed-slot" data-ofm-embed="${payload}"><span class="ofm-embed-empty">Loading embed: ${escapeHtml(label)}</span></span>`;
        i = closeEmbed + 2;
        continue;
      }
    }

    // 8. Wikilinks [[...]]
    if (ctx.settings.syntaxWikilinks && source.startsWith("[[", i)) {
      const closeWiki = source.indexOf("]]", i + 2);
      const newline = source.indexOf("\n", i + 2);
      if (closeWiki !== -1 && (newline === -1 || closeWiki < newline)) {
        const inner = source.slice(i + 2, closeWiki);
        const ref = parseWikilinkInner(inner, false);
        ctx.links.push(ref);
        const resolved = ctx.isResolvedLink ? ctx.isResolvedLink(ref) : true;
        const cls = resolved ? "ofm-wikilink" : "ofm-wikilink ofm-wikilink-unresolved";
        const label = formatWikilinkLabel(ref);
        const payload = escapeAttr(JSON.stringify(ref));
        out += `<a href="#" class="${cls}" data-ofm-wikilink="${payload}">${escapeHtml(label)}</a>`;
        i = closeWiki + 2;
        continue;
      }
    }

    // 9. Inline footnote ^[text]
    if (ctx.settings.syntaxFootnotes && source.startsWith("^[", i)) {
      const closeBracket = source.indexOf("]", i + 2);
      const newline = source.indexOf("\n", i + 2);
      if (closeBracket !== -1 && (newline === -1 || closeBracket < newline)) {
        ctx.inlineFootnotes += 1;
        const inlineId = `inline-${ctx.inlineFootnotes}`;
        ctx.footnoteDefs.set(inlineId, source.slice(i + 2, closeBracket).trim());
        out += renderFootnoteBadge(inlineId, ctx);
        i = closeBracket + 1;
        continue;
      }
    }

    // 10. Reference footnote [^id]
    if (ctx.settings.syntaxFootnotes && source.startsWith("[^", i)) {
      const closeBracket = source.indexOf("]", i + 2);
      const newline = source.indexOf("\n", i + 2);
      if (closeBracket !== -1 && (newline === -1 || closeBracket < newline)) {
        const id = source.slice(i + 2, closeBracket).trim();
        if (id && !/\s/.test(id) && ctx.footnoteDefs.has(id)) {
          out += renderFootnoteBadge(id, ctx);
          i = closeBracket + 1;
          continue;
        }
      }
    }

    // 11. Standard Markdown image ![alt](url)
    if (source.startsWith("![", i)) {
      const closeLabel = source.indexOf("]", i + 2);
      if (closeLabel !== -1 && source[closeLabel + 1] === "(") {
        const closeParen = findMatchingParen(source, closeLabel + 1);
        if (closeParen !== -1) {
          const alt = source.slice(i + 2, closeLabel);
          const { url, tooltip } = parseMarkdownDestination(source.slice(closeLabel + 2, closeParen));
          const safeSrc = sanitizeImageSrc(url);
          if (safeSrc) {
            const tipAttr = tooltip ? ` data-ofm-tooltip="${escapeAttr(tooltip)}"` : "";
            out += `<img src="${escapeAttr(safeSrc)}" alt="${escapeAttr(alt)}"${tipAttr} />`;
          } else {
            out += escapeHtml(source.slice(i, closeParen + 1));
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // 12. Standard Markdown link [text](url)
    if (ch === "[") {
      const closeLabel = source.indexOf("]", i + 1);
      if (closeLabel !== -1 && source[closeLabel + 1] === "(") {
        const closeParen = findMatchingParen(source, closeLabel + 1);
        if (closeParen !== -1) {
          const labelRaw = source.slice(i + 1, closeLabel);
          const { url, tooltip } = parseMarkdownDestination(source.slice(closeLabel + 2, closeParen));
          const safeHref = sanitizeHref(url);
          if (safeHref) {
            const external = /^https?:/i.test(safeHref);
            const targetAttr = external ? ' target="_blank" rel="noopener noreferrer"' : "";
            const tipAttr = tooltip ? ` data-ofm-tooltip="${escapeAttr(tooltip)}"` : "";
            out += `<a href="${escapeAttr(safeHref)}"${targetAttr}${tipAttr}>${parseInline(labelRaw, ctx)}</a>`;
          } else {
            out += parseInline(labelRaw, ctx);
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // 13. Highlight ==text==
    if (ctx.settings.syntaxHighlights && source.startsWith("==", i) && !/\s/.test(source[i + 2] ?? "")) {
      const closeMark = findClosingDelimiter(source, i + 2, "==", false);
      if (closeMark !== -1) {
        out += `<mark class="ofm-highlight">${parseInline(source.slice(i + 2, closeMark), ctx)}</mark>`;
        i = closeMark + 2;
        continue;
      }
    }

    // 14. Strikethrough ~~text~~ (double tilde only; single ~ stays literal)
    if (source.startsWith("~~", i) && source[i + 2] !== "~" && !/\s/.test(source[i + 2] ?? "")) {
      const closeStrike = findClosingDelimiter(source, i + 2, "~~", false);
      if (closeStrike !== -1) {
        out += `<del>${parseInline(source.slice(i + 2, closeStrike), ctx)}</del>`;
        i = closeStrike + 2;
        continue;
      }
    }

    // 15. Bold+Italic (*** / ___)
    if ((source.startsWith("***", i) || source.startsWith("___", i)) && !/\s/.test(source[i + 3] ?? "")) {
      const delim = source.slice(i, i + 3);
      const requireWordBoundary = delim === "___";
      const prevChar = i > 0 ? source[i - 1]! : "";
      if (!requireWordBoundary || !/[\p{L}\p{N}]/u.test(prevChar)) {
        const closeTriple = findClosingDelimiter(source, i + 3, delim, requireWordBoundary);
        if (closeTriple !== -1) {
          out += `<strong><em>${parseInline(source.slice(i + 3, closeTriple), ctx)}</em></strong>`;
          i = closeTriple + 3;
          continue;
        }
      }
    }

    // 16. Bold (** / __)
    if ((source.startsWith("**", i) || source.startsWith("__", i)) && !/\s/.test(source[i + 2] ?? "")) {
      const delim = source.slice(i, i + 2);
      const requireWordBoundary = delim === "__";
      const prevChar = i > 0 ? source[i - 1]! : "";
      if (!requireWordBoundary || !/[\p{L}\p{N}]/u.test(prevChar)) {
        const closeBold = findClosingDelimiter(source, i + 2, delim, requireWordBoundary);
        if (closeBold !== -1) {
          out += `<strong>${parseInline(source.slice(i + 2, closeBold), ctx)}</strong>`;
          i = closeBold + 2;
          continue;
        }
      }
    }

    // 17. Italic (* / _)
    if ((ch === "*" || ch === "_") && source[i + 1] !== ch && !/\s/.test(source[i + 1] ?? "")) {
      const requireWordBoundary = ch === "_";
      const prevChar = i > 0 ? source[i - 1]! : "";
      if (!requireWordBoundary || !/[\p{L}\p{N}]/u.test(prevChar)) {
        const closeItalic = findClosingDelimiter(source, i + 1, ch, requireWordBoundary);
        if (closeItalic !== -1) {
          out += `<em>${parseInline(source.slice(i + 1, closeItalic), ctx)}</em>`;
          i = closeItalic + 1;
          continue;
        }
      }
    }

    // 18. Autolink URL
    if ((ch === "h" || ch === "H") && /^https?:\/\/[^\s<>()]+/i.test(source.slice(i))) {
      const urlMatch = /^https?:\/\/[^\s<>()]+/i.exec(source.slice(i))!;
      let rawUrl = urlMatch[0];
      while (/[.,;:!?]$/.test(rawUrl)) {
        rawUrl = rawUrl.slice(0, -1);
      }
      const safeHref = sanitizeHref(rawUrl);
      if (safeHref) {
        out += `<a href="${escapeAttr(safeHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawUrl)}</a>`;
        i += rawUrl.length;
        continue;
      }
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
};

const splitTableCells = (line: string): string[] => {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = "";
  let inTicks = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (ch === "\\" && trimmed[i + 1] === "|") {
      // Keep \| intact inside wikilinks so parseWikilinkInner splits alias properly; unescape elsewhere.
      current += "\\|";
      i += 1;
      continue;
    }
    if (ch === "`") {
      let ticks = 1;
      while (trimmed[i + ticks] === "`") ticks += 1;
      if (inTicks === 0) inTicks = ticks;
      else if (inTicks === ticks) inTicks = 0;
      current += "`".repeat(ticks);
      i += ticks - 1;
      continue;
    }
    if (ch === "|" && inTicks === 0) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
};

const isTableSeparatorRow = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitTableCells(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
};

const parseTableAlignments = (separatorLine: string): Array<"left" | "center" | "right" | null> =>
  splitTableCells(separatorLine).map((cell) => {
    const t = cell.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });

const collectFootnoteDefinitions = (lines: SourceLine[], ctx: ParseContext) => {
  if (!ctx.settings.syntaxFootnotes) return;
  let inFence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]!.text;
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!inFence) inFence = { char: marker[0]!, len: marker.length };
      else if (marker[0] === inFence.char && marker.length >= inFence.len) inFence = null;
      continue;
    }
    if (inFence) continue;

    const defMatch = /^\[\^([^\s\]]+)\]:[ \t]*(.*)$/.exec(text);
    if (!defMatch) continue;
    const id = defMatch[1]!;
    const parts = [defMatch[2]!.trim()];
    while (i + 1 < lines.length) {
      const nextText = lines[i + 1]!.text;
      if (/^(?: {2,}|\t)/.test(nextText)) {
        parts.push(nextText.replace(/^(?: {2,4}|\t)/, ""));
        i += 1;
        continue;
      }
      if (!nextText.trim() && i + 2 < lines.length && /^(?: {2,}|\t)/.test(lines[i + 2]!.text)) {
        parts.push("");
        i += 1;
        continue;
      }
      break;
    }
    if (!ctx.footnoteDefs.has(id)) {
      ctx.footnoteDefs.set(id, parts.join("\n").trim());
    }
  }
};

const consumeTrailingBlockId = (
  lines: SourceLine[],
  indexAfterBlock: number,
  ctx: ParseContext,
  blockMarkdown: string,
  lineNumber: number,
): { blockId: string | null; nextIndex: number } => {
  if (!ctx.settings.syntaxBlockIds || indexAfterBlock >= lines.length) {
    return { blockId: null, nextIndex: indexAfterBlock };
  }
  const match = STANDALONE_BLOCK_ID_PATTERN.exec(lines[indexAfterBlock]!.text);
  if (!match) {
    return { blockId: null, nextIndex: indexAfterBlock };
  }
  const blockId = match[1]!;
  registerBlock(ctx, blockId, blockMarkdown, lineNumber);
  return { blockId, nextIndex: indexAfterBlock + 1 };
};

const isBlockStart = (lines: SourceLine[], index: number, ctx: ParseContext): boolean => {
  const line = lines[index]!.text;
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^[ \t]{0,3}(`{3,}|~{3,})/.test(line)) return true;
  if (/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/.test(line)) return true;
  if (/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(trimmed)) return true;
  if (/^[ \t]{0,3}>/.test(line)) return true;
  if (/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.test(line)) return true;
  if (ctx.settings.syntaxMath && trimmed.startsWith("$$")) return true;
  if (ctx.settings.syntaxFootnotes && /^\[\^([^\s\]]+)\]:/.test(line)) return true;
  if (ctx.settings.syntaxStrictHtml && (HTML_TAG_PATTERN.test(trimmed) || trimmed.startsWith("<!--"))) return true;
  if (ctx.settings.syntaxComments && trimmed.startsWith("%%") && (!trimmed.includes("%%", 2) || trimmed.endsWith("%%"))) return true;
  if (ctx.settings.syntaxBlockIds && STANDALONE_BLOCK_ID_PATTERN.test(line)) return true;
  if (line.includes("|") && index + 1 < lines.length && isTableSeparatorRow(lines[index + 1]!.text)) return true;
  return false;
};

const listPattern = /^([ \t]*)([-+*]|(\d+)[.)])[ \t]+(.*)$/;

const parseList = (
  lines: SourceLine[],
  startIndex: number,
  ctx: ParseContext,
): { html: string; nextIndex: number; markdown: string } => {
  const firstMatch = listPattern.exec(lines[startIndex]!.text)!;
  const baseIndent = firstMatch[1]!.replaceAll("\t", "  ").length;
  const ordered = Boolean(firstMatch[3]);
  const tag = ordered ? "ol" : "ul";
  const items: string[] = [];
  const rawLines: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const lineObj = lines[i]!;
    const match = listPattern.exec(lineObj.text);
    if (!match) break;
    const indent = match[1]!.replaceAll("\t", "  ").length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Nested list appended to previous item.
      const nested = parseList(lines, i, ctx);
      if (items.length > 0) {
        const last = items[items.length - 1]!;
        items[items.length - 1] = `${last.slice(0, -5)}${nested.html}</li>`;
      }
      rawLines.push(nested.markdown);
      i = nested.nextIndex;
      continue;
    }

    const itemOrdered = Boolean(match[3]);
    if (itemOrdered !== ordered) break;

    rawLines.push(lineObj.text);
    let itemContent = match[4] ?? "";
    const prefixLength = lineObj.text.length - itemContent.length;

    const taskMatch = /^\[([ xX])\](?:[ \t]+(.*)|$)$/.exec(itemContent);
    const { text: strippedText, blockId } = stripTrailingBlockId(
      taskMatch ? (taskMatch[2] ?? "") : itemContent,
      ctx.settings.syntaxBlockIds,
    );

    if (blockId) {
      registerBlock(ctx, blockId, strippedText, lineObj.lineNumber);
    }
    const blockAttr = blockId ? ` id="ofm-block-${escapeAttr(blockId)}" data-ofm-block="${escapeAttr(blockId)}"` : "";
    const badge = blockId ? renderBlockIdBadge(blockId, ctx) : "";

    i += 1;
    // Collect nested list immediately under this item.
    let nestedHtml = "";
    if (i < lines.length) {
      const nextMatch = listPattern.exec(lines[i]!.text);
      if (nextMatch && nextMatch[1]!.replaceAll("\t", "  ").length > baseIndent) {
        const nested = parseList(lines, i, ctx);
        nestedHtml = nested.html;
        rawLines.push(nested.markdown);
        i = nested.nextIndex;
      }
    }

    if (taskMatch) {
      const checked = taskMatch[1]!.toLowerCase() === "x";
      const markerOffset = lineObj.offset + prefixLength;
      ctx.tasks.push({
        checked,
        offset: markerOffset,
        line: lineObj.lineNumber,
        text: strippedText,
      });
      const checkedAttr = checked ? " checked" : "";
      const checkedClass = checked ? " ofm-task-item-checked" : "";
      items.push(
        `<li class="ofm-task-item${checkedClass}"${blockAttr}><input type="checkbox" class="ofm-task-checkbox" data-ofm-task-offset="${markerOffset}" aria-label="${escapeAttr(strippedText || "Task item")}"${checkedAttr} /><span class="ofm-task-content">${parseInline(strippedText, ctx)}${badge}${nestedHtml}</span></li>`,
      );
    } else {
      itemContent = strippedText;
      items.push(`<li${blockAttr}>${parseInline(itemContent, ctx)}${badge}${nestedHtml}</li>`);
    }
  }

  return {
    html: `<${tag}>${items.join("")}</${tag}>`,
    nextIndex: i,
    markdown: rawLines.join("\n"),
  };
};

const renderCallout = (
  rawType: string,
  fold: string | undefined,
  explicitTitle: string | undefined,
  bodyLines: SourceLine[],
  ctx: ParseContext,
  blockId: string | null,
): string => {
  const lowered = rawType.toLowerCase();
  const canonical = CALLOUT_ALIASES[lowered] ?? "note";
  const defaultTitle = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
  const titleText = explicitTitle?.trim() ? explicitTitle.trim() : defaultTitle;
  const svgPaths = CALLOUT_SVG_PATHS[canonical] ?? CALLOUT_SVG_PATHS.note!;
  const iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgPaths}</svg>`;
  const bodyHtml = bodyLines.length ? parseBlockRange(bodyLines, ctx) : "";
  const blockAttr = blockId ? ` id="ofm-block-${escapeAttr(blockId)}" data-ofm-block="${escapeAttr(blockId)}"` : "";
  const badge = blockId ? renderBlockIdBadge(blockId, ctx) : "";

  if (fold === "+" || fold === "-") {
    const openAttr = fold === "+" ? " open" : "";
    const chevron = '<span class="ofm-callout-fold" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>';
    return `<details class="ofm-callout" data-callout="${escapeAttr(canonical)}"${openAttr}${blockAttr}><summary class="ofm-callout-header"><span class="ofm-callout-icon">${iconSvg}</span><span>${parseInline(titleText, ctx)}${badge}</span>${chevron}</summary><div class="ofm-callout-body">${bodyHtml}</div></details>`;
  }

  return `<div class="ofm-callout" data-callout="${escapeAttr(canonical)}"${blockAttr}><div class="ofm-callout-header"><span class="ofm-callout-icon">${iconSvg}</span><span>${parseInline(titleText, ctx)}${badge}</span></div><div class="ofm-callout-body">${bodyHtml}</div></div>`;
};

const parseBlockRange = (lines: SourceLine[], ctx: ParseContext): string => {
  const htmlParts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const lineObj = lines[i]!;
    const line = lineObj.text;
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Footnote definitions (already collected globally)
    if (ctx.settings.syntaxFootnotes && /^\[\^([^\s\]]+)\]:/.test(line)) {
      i += 1;
      while (i < lines.length) {
        const nextText = lines[i]!.text;
        if (/^(?: {2,}|\t)/.test(nextText)) {
          i += 1;
          continue;
        }
        if (!nextText.trim() && i + 1 < lines.length && /^(?: {2,}|\t)/.test(lines[i + 1]!.text)) {
          i += 1;
          continue;
        }
        break;
      }
      continue;
    }

    // 2. Block comment %%...%%
    if (ctx.settings.syntaxComments && trimmed.startsWith("%%")) {
      const sameLineClose = trimmed.indexOf("%%", 2);
      if (sameLineClose !== -1 && sameLineClose === trimmed.length - 2) {
        const commentText = trimmed.slice(2, -2).trim();
        if (ctx.settings.readerShowComments && commentText) {
          htmlParts.push(`<div class="ofm-comment-badge">${escapeHtml(commentText)}</div>`);
        }
        i += 1;
        continue;
      }
      if (sameLineClose === -1) {
        const commentLines = [trimmed.slice(2)];
        let j = i + 1;
        let closed = false;
        while (j < lines.length) {
          const next = lines[j]!.text;
          const endIdx = next.indexOf("%%");
          if (endIdx !== -1) {
            commentLines.push(next.slice(0, endIdx));
            closed = true;
            j += 1;
            break;
          }
          commentLines.push(next);
          j += 1;
        }
        if (closed) {
          const commentText = commentLines.join("\n").trim();
          if (ctx.settings.readerShowComments && commentText) {
            htmlParts.push(`<div class="ofm-comment-badge">${escapeHtml(commentText)}</div>`);
          }
          i = j;
          continue;
        }
      }
    }

    // 3. Fenced code block
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const fenceChar = fence[0]!;
      const fenceLen = fence.length;
      const lang = fenceMatch[2]!.trim().split(/\s+/)[0] ?? "";
      const codeLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const closeLine = lines[j]!.text;
        const closeMatch = new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`).exec(closeLine);
        if (closeMatch) {
          j += 1;
          break;
        }
        codeLines.push(closeLine);
        j += 1;
      }
      const codeRaw = codeLines.join("\n");
      const rawBlock = lines.slice(i, j).map((l) => l.text).join("\n");
      const trailing = consumeTrailingBlockId(lines, j, ctx, rawBlock, lineObj.lineNumber);
      const blockAttr = trailing.blockId ? ` id="ofm-block-${escapeAttr(trailing.blockId)}" data-ofm-block="${escapeAttr(trailing.blockId)}"` : "";
      const badge = trailing.blockId ? renderBlockIdBadge(trailing.blockId, ctx) : "";

      if (ctx.settings.syntaxMath && lang.toLowerCase() === "math") {
        htmlParts.push(`<div class="ofm-math-block"${blockAttr}>${escapeHtml(codeRaw)}${badge}</div>`);
      } else {
        const langLabel = lang || "text";
        htmlParts.push(
          `<div class="ofm-code-wrap"${blockAttr}><div class="ofm-code-header"><span>${escapeHtml(langLabel)}</span><div>${badge}<button type="button" class="ofm-code-copy" data-ofm-copy-code="${escapeAttr(codeRaw)}">Copy</button></div></div><pre><code class="language-${escapeAttr(langLabel)}">${escapeHtml(codeRaw)}</code></pre></div>`,
        );
      }
      i = trailing.nextIndex;
      continue;
    }

    // 4. Display math $$...$$
    if (ctx.settings.syntaxMath && trimmed.startsWith("$$")) {
      if (trimmed.length > 4 && trimmed.endsWith("$$")) {
        const latex = trimmed.slice(2, -2).trim();
        const trailing = consumeTrailingBlockId(lines, i + 1, ctx, line, lineObj.lineNumber);
        const blockAttr = trailing.blockId ? ` id="ofm-block-${escapeAttr(trailing.blockId)}" data-ofm-block="${escapeAttr(trailing.blockId)}"` : "";
        const badge = trailing.blockId ? renderBlockIdBadge(trailing.blockId, ctx) : "";
        htmlParts.push(`<div class="ofm-math-block"${blockAttr}>${escapeHtml(latex)}${badge}</div>`);
        i = trailing.nextIndex;
        continue;
      }
      const mathLines: string[] = [trimmed.slice(2)];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const nextTrim = lines[j]!.text.trim();
        if (nextTrim.endsWith("$$")) {
          const before = nextTrim.slice(0, -2);
          if (before) mathLines.push(before);
          closed = true;
          j += 1;
          break;
        }
        mathLines.push(lines[j]!.text);
        j += 1;
      }
      if (closed) {
        const latex = mathLines.join("\n").trim();
        const rawBlock = lines.slice(i, j).map((l) => l.text).join("\n");
        const trailing = consumeTrailingBlockId(lines, j, ctx, rawBlock, lineObj.lineNumber);
        const blockAttr = trailing.blockId ? ` id="ofm-block-${escapeAttr(trailing.blockId)}" data-ofm-block="${escapeAttr(trailing.blockId)}"` : "";
        const badge = trailing.blockId ? renderBlockIdBadge(trailing.blockId, ctx) : "";
        htmlParts.push(`<div class="ofm-math-block"${blockAttr}>${escapeHtml(latex)}${badge}</div>`);
        i = trailing.nextIndex;
        continue;
      }
    }

    // 5. HTML Block (Strict Obsidian rule: do NOT parse Markdown inside HTML blocks)
    if (ctx.settings.syntaxStrictHtml && (trimmed.startsWith("<!--") || HTML_TAG_PATTERN.test(trimmed))) {
      if (trimmed.startsWith("<!--")) {
        let j = i;
        while (j < lines.length && !lines[j]!.text.includes("-->")) j += 1;
        i = Math.min(j + 1, lines.length);
        continue;
      }
      const tagMatch = HTML_TAG_PATTERN.exec(trimmed)!;
      const tagName = tagMatch[1]!.toLowerCase();
      const openRegex = new RegExp(`<${tagName}\\b[^>]*?(?<!\\/)>`, "gi");
      const closeRegex = new RegExp(`<\\/${tagName}\\s*>`, "gi");
      let depth = 0;
      let j = i;
      const htmlLines: string[] = [];
      let closed = VOID_HTML_TAGS.has(tagName) || tagMatch[3] === "/";
      if (closed) {
        htmlLines.push(line);
        j = i + 1;
      } else {
        while (j < lines.length) {
          const currentLine = lines[j]!.text;
          htmlLines.push(currentLine);
          const opens = currentLine.match(openRegex)?.length ?? 0;
          const closes = currentLine.match(closeRegex)?.length ?? 0;
          depth += opens - closes;
          j += 1;
          if (depth <= 0) {
            closed = true;
            break;
          }
        }
        if (!closed) {
          // Unclosed HTML tag falls back to blank-line termination.
          htmlLines.length = 0;
          j = i;
          while (j < lines.length && lines[j]!.text.trim()) {
            htmlLines.push(lines[j]!.text);
            j += 1;
          }
        }
      }
      htmlParts.push(sanitizeRawHtml(htmlLines.join("\n")));
      i = j;
      continue;
    }

    // 6. Heading (# to ######)
    const headingMatch = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const rawText = (headingMatch[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "");
      const { text: cleanText, blockId } = stripTrailingBlockId(rawText, ctx.settings.syntaxBlockIds);
      const slug = allocateHeadingSlug(ctx, cleanText);
      ctx.headings.push({ level, text: cleanText, slug, line: lineObj.lineNumber });
      if (blockId) {
        registerBlock(ctx, blockId, `${headingMatch[1]!} ${cleanText}`, lineObj.lineNumber);
      }
      const blockAttr = blockId ? ` data-ofm-block="${escapeAttr(blockId)}"` : "";
      const badge = blockId ? renderBlockIdBadge(blockId, ctx) : "";
      htmlParts.push(
        `<h${level} id="ofm-heading-${escapeAttr(slug)}" data-ofm-heading="${escapeAttr(cleanText)}"${blockAttr}>${parseInline(cleanText, ctx)}${badge}</h${level}>`,
      );
      i += 1;
      continue;
    }

    // 7. Horizontal rule
    if (/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(trimmed)) {
      htmlParts.push("<hr />");
      i += 1;
      continue;
    }

    // 8. Callout or Blockquote (> ...)
    if (/^[ \t]{0,3}>/.test(line)) {
      const innerLines: SourceLine[] = [];
      const rawQuoteLines: string[] = [];
      let j = i;
      while (j < lines.length && /^[ \t]{0,3}>/.test(lines[j]!.text)) {
        const rawLine = lines[j]!.text;
        rawQuoteLines.push(rawLine);
        const stripped = rawLine.replace(/^[ \t]{0,3}>[ \t]?/, "");
        innerLines.push({
          text: stripped,
          offset: lines[j]!.offset + (rawLine.length - stripped.length),
          lineNumber: lines[j]!.lineNumber,
        });
        j += 1;
      }

      const rawQuoteMarkdown = rawQuoteLines.join("\n");
      const trailing = consumeTrailingBlockId(lines, j, ctx, rawQuoteMarkdown, lineObj.lineNumber);
      const firstInner = innerLines[0]?.text ?? "";
      const calloutMatch = ctx.settings.syntaxCallouts
        ? /^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/.exec(firstInner.trim())
        : null;

      if (calloutMatch) {
        const [, rawType, fold, titlePart] = calloutMatch;
        const bodySlice = innerLines.slice(1);
        let calloutBlockId = trailing.blockId;
        if (!calloutBlockId && bodySlice.length > 0 && ctx.settings.syntaxBlockIds) {
          const lastInner = bodySlice[bodySlice.length - 1]!;
          const innerStandalone = STANDALONE_BLOCK_ID_PATTERN.exec(lastInner.text);
          if (innerStandalone) {
            calloutBlockId = innerStandalone[1]!;
            bodySlice.pop();
            registerBlock(ctx, calloutBlockId, rawQuoteMarkdown, lineObj.lineNumber);
          }
        }
        htmlParts.push(renderCallout(rawType!, fold, titlePart, bodySlice, ctx, calloutBlockId));
      } else {
        let quoteBlockId = trailing.blockId;
        if (!quoteBlockId && innerLines.length > 0 && ctx.settings.syntaxBlockIds) {
          const lastInner = innerLines[innerLines.length - 1]!;
          const innerStandalone = STANDALONE_BLOCK_ID_PATTERN.exec(lastInner.text);
          if (innerStandalone) {
            quoteBlockId = innerStandalone[1]!;
            innerLines.pop();
            registerBlock(ctx, quoteBlockId, rawQuoteMarkdown, lineObj.lineNumber);
          }
        }
        const blockAttr = quoteBlockId ? ` id="ofm-block-${escapeAttr(quoteBlockId)}" data-ofm-block="${escapeAttr(quoteBlockId)}"` : "";
        const badge = quoteBlockId ? renderBlockIdBadge(quoteBlockId, ctx) : "";
        htmlParts.push(`<blockquote${blockAttr}>${parseBlockRange(innerLines, ctx)}${badge}</blockquote>`);
      }

      i = trailing.nextIndex;
      continue;
    }

    // 9. GFM Table
    if (line.includes("|") && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]!.text)) {
      const headers = splitTableCells(line);
      const alignments = parseTableAlignments(lines[i + 1]!.text);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j]!.text.trim() && lines[j]!.text.includes("|") && !STANDALONE_BLOCK_ID_PATTERN.test(lines[j]!.text)) {
        rows.push(splitTableCells(lines[j]!.text));
        j += 1;
      }
      const rawTable = lines.slice(i, j).map((l) => l.text).join("\n");
      const trailing = consumeTrailingBlockId(lines, j, ctx, rawTable, lineObj.lineNumber);
      const blockAttr = trailing.blockId ? ` id="ofm-block-${escapeAttr(trailing.blockId)}" data-ofm-block="${escapeAttr(trailing.blockId)}"` : "";
      const badge = trailing.blockId ? renderBlockIdBadge(trailing.blockId, ctx) : "";

      const renderCells = (cells: string[], cellTag: "th" | "td") =>
        cells.map((cell, colIndex) => {
          const align = alignments[colIndex];
          const alignAttr = align ? ` align="${align}"` : "";
          const unescapedCell = cell.includes("[[") ? cell : cell.replaceAll("\\|", "|");
          return `<${cellTag}${alignAttr}>${parseInline(unescapedCell, ctx)}</${cellTag}>`;
        }).join("");

      const thead = `<thead><tr>${renderCells(headers, "th")}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map((row) => `<tr>${renderCells(row, "td")}</tr>`).join("")}</tbody>`
        : "";
      htmlParts.push(`<div class="ofm-table-wrap"${blockAttr}><table>${thead}${tbody}</table>${badge}</div>`);
      i = trailing.nextIndex;
      continue;
    }

    // 10. Lists (-, *, +, 1.)
    if (listPattern.test(line)) {
      const list = parseList(lines, i, ctx);
      const trailing = consumeTrailingBlockId(lines, list.nextIndex, ctx, list.markdown, lineObj.lineNumber);
      if (trailing.blockId) {
        htmlParts.push(`<div id="ofm-block-${escapeAttr(trailing.blockId)}" data-ofm-block="${escapeAttr(trailing.blockId)}">${list.html}${renderBlockIdBadge(trailing.blockId, ctx)}</div>`);
      } else {
        htmlParts.push(list.html);
      }
      i = trailing.nextIndex;
      continue;
    }

    // 11. Standalone ^block-id
    if (ctx.settings.syntaxBlockIds) {
      const standalone = STANDALONE_BLOCK_ID_PATTERN.exec(line);
      if (standalone) {
        const blockId = standalone[1]!;
        registerBlock(ctx, blockId, "", lineObj.lineNumber);
        htmlParts.push(`<div id="ofm-block-${escapeAttr(blockId)}" data-ofm-block="${escapeAttr(blockId)}">${renderBlockIdBadge(blockId, ctx)}</div>`);
        i += 1;
        continue;
      }
    }

    // 12. Paragraph (including single-line embeds rendered as block container when alone in paragraph)
    const paraLines: SourceLine[] = [];
    let j = i;
    while (j < lines.length) {
      if (j > i && isBlockStart(lines, j, ctx)) break;
      paraLines.push(lines[j]!);
      j += 1;
    }

    const rawParagraph = paraLines.map((l) => l.text).join("\n");
    const lastLine = paraLines[paraLines.length - 1]!.text;
    const { text: lastWithoutBlock, blockId: inlineBlockId } = stripTrailingBlockId(lastLine, ctx.settings.syntaxBlockIds);
    const cleanedLines = [...paraLines.slice(0, -1).map((l) => l.text), lastWithoutBlock];
    const paragraphText = cleanedLines.join("\n").trim();

    let blockId = inlineBlockId;
    let nextIndex = j;
    if (!blockId) {
      const trailing = consumeTrailingBlockId(lines, j, ctx, rawParagraph, lineObj.lineNumber);
      blockId = trailing.blockId;
      nextIndex = trailing.nextIndex;
    }

    if (blockId) {
      registerBlock(ctx, blockId, paragraphText, lineObj.lineNumber);
    }

    const blockAttr = blockId ? ` id="ofm-block-${escapeAttr(blockId)}" data-ofm-block="${escapeAttr(blockId)}"` : "";
    const badge = blockId ? renderBlockIdBadge(blockId, ctx) : "";

    if (ctx.settings.syntaxEmbeds && /^!\[\[[^\]\r\n]+\]\]$/.test(paragraphText)) {
      const ref = parseWikilinkInner(paragraphText.slice(3, -2), true);
      ctx.links.push(ref);
      const payload = escapeAttr(JSON.stringify(ref));
      const label = formatWikilinkLabel(ref);
      htmlParts.push(`<div class="ofm-embed-slot" data-ofm-embed="${payload}"${blockAttr}><div class="ofm-embed-empty">Loading embed: ${escapeHtml(label)}</div>${badge}</div>`);
    } else if (paragraphText) {
      htmlParts.push(`<p${blockAttr}>${parseInline(paragraphText, ctx)}${badge}</p>`);
    } else if (badge) {
      htmlParts.push(`<div${blockAttr}>${badge}</div>`);
    }

    i = nextIndex;
  }

  return htmlParts.join("\n");
};

const renderFootnotesSection = (ctx: ParseContext): string => {
  if (!ctx.settings.syntaxFootnotes || ctx.footnoteOrder.length === 0) return "";
  const items = ctx.footnoteOrder.map((id) => {
    const body = ctx.footnoteDefs.get(id) ?? "";
    const count = ctx.footnoteRefCounts.get(id) ?? 1;
    const backrefs = Array.from({ length: count }, (_, idx) => {
      const refId = `ofm-fnref-${encodeURIComponent(id)}-${idx + 1}`;
      const label = count > 1 ? `↩${idx + 1}` : "↩";
      return `<a href="#${escapeAttr(refId)}" class="ofm-footnote-backref" data-ofm-scroll-id="${escapeAttr(refId)}" aria-label="Back to reference">${label}</a>`;
    }).join(" ");
    const renderedBody = parseInline(body, ctx);
    return `<li id="ofm-fn-${escapeAttr(encodeURIComponent(id))}">${renderedBody} ${backrefs}</li>`;
  });
  return `<section class="ofm-footnotes" aria-label="Footnotes"><ol>${items.join("")}</ol></section>`;
};

export const parseOfmDocument = (
  markdown: string,
  options: OfmParseOptions = {},
): ParsedOfmDocument => {
  const settings: OfmSettings = { ...DEFAULT_OFM_SETTINGS, ...options.settings };
  const fm = splitFrontmatter(markdown);
  const bodyLines = fm.lines.slice(fm.bodyStartLineIndex);

  const ctx: ParseContext = {
    settings,
    isResolvedLink: options.isResolvedLink,
    headings: [],
    headingSlugCounts: new Map(),
    blocks: {},
    links: [],
    tasks: [],
    footnoteDefs: new Map(),
    footnoteOrder: [],
    footnoteRefCounts: new Map(),
    inlineFootnotes: 0,
  };

  collectFootnoteDefinitions(bodyLines, ctx);
  const bodyHtml = parseBlockRange(bodyLines, ctx);
  const footnotesHtml = renderFootnotesSection(ctx);
  const html = `${bodyHtml}${footnotesHtml ? `\n${footnotesHtml}` : ""}`;

  return {
    frontmatter: fm.frontmatter,
    body: fm.body,
    bodyOffset: fm.bodyOffset,
    headings: ctx.headings,
    blocks: ctx.blocks,
    links: ctx.links,
    tasks: ctx.tasks,
    html,
  };
};

export const extractHeadingSection = (markdown: string, headingQuery: string): string | null => {
  const normalizedTarget = headingQuery.trim().toLowerCase();
  if (!normalizedTarget) return null;

  const fm = splitFrontmatter(markdown);
  const bodyLines = fm.lines.slice(fm.bodyStartLineIndex);
  let inFence: { char: string; len: number } | null = null;
  let startLine = -1;
  let targetLevel = 0;

  for (let i = 0; i < bodyLines.length; i += 1) {
    const text = bodyLines[i]!.text;
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!inFence) inFence = { char: marker[0]!, len: marker.length };
      else if (marker[0] === inFence.char && marker.length >= inFence.len) inFence = null;
      continue;
    }
    if (inFence) continue;

    const headingMatch = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/.exec(text);
    if (!headingMatch) continue;
    const level = headingMatch[1]!.length;
    const rawHeading = headingMatch[2]!.replace(/[ \t]+#+[ \t]*$/, "");
    const { text: cleanHeading } = stripTrailingBlockId(rawHeading, true);
    const cleanedLower = cleanHeading.trim().toLowerCase();

    if (startLine === -1) {
      if (cleanedLower === normalizedTarget || slugifyHeading(cleanHeading) === slugifyHeading(headingQuery)) {
        startLine = i;
        targetLevel = level;
      }
      continue;
    }

    if (level <= targetLevel) {
      return bodyLines.slice(startLine, i).map((l) => l.text).join("\n").trim();
    }
  }

  if (startLine !== -1) {
    return bodyLines.slice(startLine).map((l) => l.text).join("\n").trim();
  }
  return null;
};

export const extractBlockMarkdown = (markdown: string, blockId: string): string | null => {
  const parsed = parseOfmDocument(markdown);
  return parsed.blocks[blockId]?.markdown ?? null;
};
