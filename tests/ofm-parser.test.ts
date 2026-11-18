import { describe, expect, test } from "bun:test";
import { convertOfmToStandardMarkdown, convertStandardToOfmMarkdown } from "../src/converter.ts";
import {
  extractBlockMarkdown,
  extractHeadingSection,
  parseOfmDocument,
  parseWikilinkInner,
} from "../src/ofm-parser.ts";

describe("OFM Parser & Syntax Extensions", () => {
  test("parses wikilinks, aliases, heading links, block links, and table escaped pipes", () => {
    const md = [
      "See [[Target Note]], [[Target Note|Custom Alias]], [[Target Note#Architecture]], [[Target Note#^key-id]], and [[#Local Section]].",
      "",
      "| Syntax | Example |",
      "| --- | --- |",
      "| Wikilink | [[Internal links\\|Alias in table]] |",
      "| Embed | ![[diagram.png\\|240]] |",
    ].join("\n");

    const parsed = parseOfmDocument(md, {
      isResolvedLink: (ref) => ref.target === "Target Note" || ref.target === "Internal links" || !ref.target,
    });

    expect(parsed.links.map((l) => ({
      target: l.target,
      heading: l.heading,
      blockId: l.blockId,
      alias: l.alias,
      width: l.width,
      isEmbed: l.isEmbed,
    }))).toEqual([
      { target: "Target Note", heading: undefined, blockId: undefined, alias: undefined, width: undefined, isEmbed: false },
      { target: "Target Note", heading: undefined, blockId: undefined, alias: "Custom Alias", width: undefined, isEmbed: false },
      { target: "Target Note", heading: "Architecture", blockId: undefined, alias: undefined, width: undefined, isEmbed: false },
      { target: "Target Note", heading: undefined, blockId: "key-id", alias: undefined, width: undefined, isEmbed: false },
      { target: "", heading: "Local Section", blockId: undefined, alias: undefined, width: undefined, isEmbed: false },
      { target: "Internal links", heading: undefined, blockId: undefined, alias: "Alias in table", width: undefined, isEmbed: false },
      { target: "diagram.png", heading: undefined, blockId: undefined, alias: undefined, width: 240, isEmbed: true },
    ]);

    expect(parsed.html).toContain(">Target Note<");
    expect(parsed.html).toContain(">Custom Alias<");
    expect(parsed.html).toContain(">Target Note &gt; Architecture<");
    expect(parsed.html).toContain(">Target Note &gt; ^key-id<");
    expect(parsed.html).toContain(">#Local Section<");
    expect(parsed.html).toContain(">Alias in table<");
    expect(parsed.html).toContain("data-ofm-embed=");
  });

  test("parses embed sizing modifiers for images", () => {
    expect(parseWikilinkInner("photo.png|300", true)).toMatchObject({
      isEmbed: true,
      target: "photo.png",
      width: 300,
    });
    expect(parseWikilinkInner("photo.png|320x180", true)).toMatchObject({
      isEmbed: true,
      target: "photo.png",
      width: 320,
      height: 180,
    });
    expect(parseWikilinkInner("photo.png|Cover Image|400x250", true)).toMatchObject({
      isEmbed: true,
      target: "photo.png",
      alias: "Cover Image",
      width: 400,
      height: 250,
    });
  });

  test("recognizes ^block-id anchors on paragraphs, lists, quotes, tables, and standalone lines", () => {
    const md = [
      "Paragraph with anchor. ^para-1",
      "",
      "- List item anchor ^item-1",
      "",
      "> Quoted insight",
      "^quote-1",
      "",
      "| Col | Val |",
      "| --- | --- |",
      "| A | B |",
      "^table-1",
    ].join("\n");

    const parsed = parseOfmDocument(md);
    expect(Object.keys(parsed.blocks)).toEqual(["para-1", "item-1", "quote-1", "table-1"]);
    expect(parsed.blocks["para-1"]?.markdown).toBe("Paragraph with anchor.");
    expect(parsed.blocks["item-1"]?.markdown).toBe("List item anchor");
    expect(parsed.blocks["quote-1"]?.markdown).toContain("Quoted insight");
    expect(parsed.blocks["table-1"]?.markdown).toContain("| A | B |");
    expect(parsed.html).toContain('data-ofm-copy-block="para-1"');
    expect(parsed.html).toContain('id="ofm-block-table-1"');
  });

  test("renders foldable and nested callouts across aliases", () => {
    const md = [
      "> [!tip]+ Expandable Tip",
      "> First line with ==highlight==.",
      ">",
      "> > [!warning]- Nested Warning",
      "> > Hidden until clicked.",
      "",
      "> [!faq] Questions?",
      "> Answered here.",
    ].join("\n");

    const parsed = parseOfmDocument(md);
    expect(parsed.html).toContain('<details class="ofm-callout" data-callout="tip" open>');
    expect(parsed.html).toContain('<details class="ofm-callout" data-callout="warning">');
    expect(parsed.html).toContain('<div class="ofm-callout" data-callout="question">');
    expect(parsed.html).toContain('<mark class="ofm-highlight">highlight</mark>');
  });

  test("handles footnotes, repeated refs, multi-line definitions, and inline footnotes", () => {
    const md = [
      "First claim[^fn1] and repeated[^fn1] plus inline^[Inline note text].",
      "",
      "[^fn1]: Multi-line footnote",
      "  continuation line.",
    ].join("\n");

    const parsed = parseOfmDocument(md);
    expect(parsed.html).toContain('id="ofm-fnref-fn1-1"');
    expect(parsed.html).toContain('id="ofm-fnref-fn1-2"');
    expect(parsed.html).toContain('id="ofm-fn-fn1"');
    expect(parsed.html).toContain("Multi-line footnote\ncontinuation line.");
    expect(parsed.html).toContain("Inline note text");
    expect(parsed.html).toContain("↩1");
    expect(parsed.html).toContain("↩2");
  });

  test("strips or shows %%comments%% outside code blocks", () => {
    const md = [
      "Visible %%hidden inline%% text.",
      "",
      "%%",
      "Multi-line hidden block",
      "%%",
      "",
      "Inline `%%literal in code%%` stays.",
      "",
      "```md",
      "%%fenced literal%%",
      "```",
    ].join("\n");

    const hidden = parseOfmDocument(md, { settings: { readerShowComments: false } });
    expect(hidden.html).not.toContain("hidden inline");
    expect(hidden.html).not.toContain("Multi-line hidden block");
    expect(hidden.html).toContain("<code>%%literal in code%%</code>");
    expect(hidden.html).toContain("%%fenced literal%%");

    const shown = parseOfmDocument(md, { settings: { readerShowComments: true } });
    expect(shown.html).toContain('<span class="ofm-comment-badge"');
    expect(shown.html).toContain("hidden inline");
    expect(shown.html).toContain("Multi-line hidden block");
  });

  test("handles highlights, strikethrough, single tildes, and LaTeX math without matching currency", () => {
    const md = [
      "Keep ~10ms literal, strike ~~old~~, highlight ==**important**==.",
      "",
      "Price is $100 and $200 today, while energy is $E = mc^2$.",
      "",
      "$$",
      "a^2 + b^2 = c^2",
      "$$",
    ].join("\n");

    const parsed = parseOfmDocument(md);
    expect(parsed.html).toContain("Keep ~10ms literal");
    expect(parsed.html).toContain("<del>old</del>");
    expect(parsed.html).toContain('<mark class="ofm-highlight"><strong>important</strong></mark>');
    expect(parsed.html).toContain("Price is $100 and $200 today");
    expect(parsed.html).toContain('<span class="ofm-math-inline" data-ofm-latex="E = mc^2">E = mc^2</span>');
    expect(parsed.html).toContain('<div class="ofm-math-block">a^2 + b^2 = c^2</div>');
  });

  test("follows strict Obsidian HTML rule: does not parse Markdown inside HTML elements", () => {
    const md = [
      "<div>",
      "This **will not** be bold or ==highlighted==.",
      "</div>",
      "",
      "Inline <span>**also not bold**</span> test.",
    ].join("\n");

    const strict = parseOfmDocument(md, { settings: { syntaxStrictHtml: true } });
    expect(strict.html).toContain("This **will not** be bold or ==highlighted==.");
    expect(strict.html).not.toContain("<strong>will not</strong>");
    expect(strict.html).toContain("<span>**also not bold**</span>");
  });

  test("records exact UTF-16 offsets for task list items even with frontmatter and CRLF", () => {
    const md = "---\r\ntags: [work]\r\n---\r\n\r\n- [ ] First task\r\n- [x] Done task\r\n";
    const parsed = parseOfmDocument(md);

    expect(parsed.frontmatter).toEqual([{ key: "tags", value: "[work]" }]);
    expect(parsed.tasks).toHaveLength(2);
    expect(md.slice(parsed.tasks[0]!.offset, parsed.tasks[0]!.offset + 3)).toBe("[ ]");
    expect(md.slice(parsed.tasks[1]!.offset, parsed.tasks[1]!.offset + 3)).toBe("[x]");
  });

  test("extracts heading sections and blocks cleanly", () => {
    const md = [
      "---",
      "title: Design",
      "---",
      "# Overview",
      "Top summary ^sum-1",
      "## Details",
      "Deep dive line.",
      "### Subdetails",
      "Sub line.",
      "## Next",
      "Afterwards.",
    ].join("\n");

    const section = extractHeadingSection(md, "Details");
    expect(section).toBe("## Details\nDeep dive line.\n### Subdetails\nSub line.");
    expect(extractBlockMarkdown(md, "sum-1")).toBe("Top summary");
  });

  test("sanitizes unsafe HTML/URLs and never emits native HTML title attributes", () => {
    const md = [
      '<script>alert(1)</script>',
      '<img src="x" onerror="alert(2)" title="bad tooltip" />',
      '[Safe Link](https://example.com "Hover Tip")',
      '[XSS Link](javascript:alert(3))',
    ].join("\n\n");

    const parsed = parseOfmDocument(md);
    expect(parsed.html).not.toContain("<script");
    expect(parsed.html).not.toContain("onerror");
    expect(parsed.html).not.toContain("javascript:");
    expect(parsed.html).not.toMatch(/\btitle\s*=/i);
    expect(parsed.html).toContain('data-ofm-tooltip="Hover Tip"');
  });

  test("converts bidirectionally between OFM and standard EdgeEver Markdown while preserving code blocks", () => {
    const ofm = [
      "---",
      "author: Alice",
      "---",
      "Read [[Project Alpha|Alpha]] and ==highlight== %%secret%%.",
      "",
      "> [!warning]- Caveat",
      "> Watch out!",
      "",
      "```md",
      "[[Project Alpha]] ==literal== %%kept%%",
      "```",
    ].join("\n");

    const standard = convertOfmToStandardMarkdown(ofm, {
      resolveNote: (target) => (target === "Project Alpha" ? { id: "memo_123", title: "Project Alpha" } : null),
    });

    expect(standard).toContain("[Alpha](#memo=memo_123)");
    expect(standard).toContain("<mark>highlight</mark>");
    expect(standard).not.toContain("%%secret%%");
    expect(standard).toContain("<details>\n<summary>WARNING: Caveat</summary>\n\nWatch out!\n\n</details>");
    expect(standard).toContain("[[Project Alpha]] ==literal== %%kept%%");

    const backToOfm = convertStandardToOfmMarkdown(standard, (id) => (id === "memo_123" ? "Project Alpha" : null));
    expect(backToOfm).toContain("[[Project Alpha|Alpha]]");
    expect(backToOfm).toContain("==highlight==");
  });
});
