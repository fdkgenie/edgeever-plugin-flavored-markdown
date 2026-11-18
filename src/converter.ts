import { formatWikilinkLabel, parseWikilinkInner, splitFrontmatter } from "./ofm-parser.ts";

export interface NoteTargetLookup {
  resolveNote(target: string): { id: string; title: string } | null;
}

const transformOutsideCode = (
  body: string,
  transformBlockText: (segment: string) => string,
): string => {
  const lines = body.split("\n");
  const out: string[] = [];
  const buffer: string[] = [];
  let inFence: { char: string; len: number } | null = null;

  const flush = () => {
    if (!buffer.length) return;
    out.push(transformBlockText(buffer.join("\n")));
    buffer.length = 0;
  };

  for (const line of lines) {
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!inFence) {
        flush();
        inFence = { char: marker[0]!, len: marker.length };
        out.push(line);
        continue;
      }
      if (marker[0] === inFence.char && marker.length >= inFence.len) {
        inFence = null;
        out.push(line);
        continue;
      }
    }
    if (inFence) {
      out.push(line);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out.join("\n");
};

const transformInlineOutsideCode = (
  text: string,
  replacer: (plain: string) => string,
): string => {
  let result = "";
  let i = 0;
  let plainStart = 0;

  while (i < text.length) {
    if (text[i] === "`") {
      let ticks = 1;
      while (text[i + ticks] === "`") ticks += 1;
      const closeIndex = text.indexOf("`".repeat(ticks), i + ticks);
      if (closeIndex !== -1) {
        if (i > plainStart) {
          result += replacer(text.slice(plainStart, i));
        }
        result += text.slice(i, closeIndex + ticks);
        i = closeIndex + ticks;
        plainStart = i;
        continue;
      }
    }
    i += 1;
  }

  if (plainStart < text.length) {
    result += replacer(text.slice(plainStart));
  }
  return result;
};

const convertCalloutsBlockToStandard = (text: string): string => {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!/^[ \t]{0,3}>/.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }

    const quoteLines: string[] = [];
    while (i < lines.length && /^[ \t]{0,3}>/.test(lines[i]!)) {
      quoteLines.push(lines[i]!.replace(/^[ \t]{0,3}>[ \t]?/, ""));
      i += 1;
    }

    const first = quoteLines[0]?.trim() ?? "";
    const calloutMatch = /^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/.exec(first);
    if (!calloutMatch) {
      out.push(...quoteLines.map((l) => (l ? `> ${l}` : ">")));
      continue;
    }

    const typeLabel = calloutMatch[1]!.toUpperCase();
    const fold = calloutMatch[2];
    const title = calloutMatch[3]?.trim() || calloutMatch[1]!;
    const body = quoteLines.slice(1).join("\n").trim();

    if (fold === "+" || fold === "-") {
      const summary = `${typeLabel}: ${title}`;
      out.push(`<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`);
    } else {
      out.push(`> **${typeLabel}: ${title}**`);
      if (body) {
        out.push(...body.split("\n").map((l) => (l ? `> ${l}` : ">")));
      }
    }
  }

  return out.join("\n");
};

export const convertOfmToStandardMarkdown = (
  markdown: string,
  lookup: NoteTargetLookup,
): string => {
  const fm = splitFrontmatter(markdown);
  const frontmatterPrefix = fm.bodyOffset > 0 ? markdown.slice(0, fm.bodyOffset) : "";
  const convertedBody = transformOutsideCode(fm.body, (segment) => {
    const withCallouts = convertCalloutsBlockToStandard(segment);
    return transformInlineOutsideCode(withCallouts, (plain) =>
      plain
        .replace(/%%[\s\S]*?%%/g, "")
        .replace(/==([^\n]+?)==/g, "<mark>$1</mark>")
        .replace(/(?<!!)\[\[([^\]\r\n]+)\]\]/g, (full, inner: string) => {
          const ref = parseWikilinkInner(inner, false);
          if (!ref.target) return full;
          const resolved = lookup.resolveNote(ref.target);
          if (!resolved) return full;
          const label = formatWikilinkLabel(ref);
          return `[${label}](#memo=${encodeURIComponent(resolved.id)})`;
        }),
    );
  });

  return `${frontmatterPrefix}${convertedBody}`;
};

export const convertStandardToOfmMarkdown = (
  markdown: string,
  getNoteTitleById: (noteId: string) => string | null,
): string => {
  const fm = splitFrontmatter(markdown);
  const frontmatterPrefix = fm.bodyOffset > 0 ? markdown.slice(0, fm.bodyOffset) : "";
  const convertedBody = transformOutsideCode(fm.body, (segment) =>
    transformInlineOutsideCode(segment, (plain) =>
      plain
        .replace(/<mark>([\s\S]*?)<\/mark>/gi, "==$1==")
        .replace(/\[([^\]]+)\]\(#memo=([^)\s]+)\)/g, (full, label: string, encodedId: string) => {
          let noteId: string;
          try {
            noteId = decodeURIComponent(encodedId);
          } catch {
            return full;
          }
          const title = getNoteTitleById(noteId);
          if (!title) return full;
          return label.trim() === title.trim() ? `[[${title}]]` : `[[${title}|${label}]]`;
        }),
    ),
  );

  return `${frontmatterPrefix}${convertedBody}`;
};
