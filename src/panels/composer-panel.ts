import type { PluginContext, PluginPanel, PluginPanelMountContext } from "@edgeever/plugin-api";
import { escapeAttr, escapeHtml } from "../sanitizer.ts";
import type { WorkspaceNoteIndex } from "../workspace-index.ts";

type ComposerMode = "link" | "callout" | "footnote";

const CALLOUT_TYPES = [
  "note",
  "abstract",
  "info",
  "todo",
  "tip",
  "success",
  "question",
  "warning",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
];

export const createComposerPanel = (
  context: PluginContext,
  index: WorkspaceNoteIndex,
): PluginPanel => ({
  id: "ofm-composer",
  title: "Insert OFM Syntax",
  purpose: "workflow",
  presentation: "dialog",
  async mount(container: HTMLElement, panelContext: PluginPanelMountContext) {
    let mode: ComposerMode = "link";
    let disposed = false;

    const initialState = panelContext.state;
    if (initialState && typeof initialState === "object" && !Array.isArray(initialState)) {
      const m = (initialState as Record<string, unknown>).mode;
      if (m === "link" || m === "callout" || m === "footnote") mode = m;
    }

    await index.ensureLoaded();
    if (disposed) return;

    const notes = index.listNotes();
    let linkKind: "link" | "embed" = "link";
    let targetNote = notes[0]?.title ?? "";
    let fragment = "";
    let alias = "";

    let calloutType = "note";
    let calloutFold: "" | "+" | "-" = "";
    let calloutTitle = "";
    let calloutBody = "Callout details here.";

    let footnoteKind: "ref" | "inline" | "block" = "ref";
    let footnoteId = "1";
    let footnoteText = "Footnote content.";
    let blockIdValue = "key-point";

    container.className = "ofm-composer";

    const buildSnippet = (): string => {
      if (mode === "link") {
        const cleanTarget = targetNote.trim() || "Note Title";
        const cleanFragment = fragment.trim();
        const fragPart = cleanFragment
          ? cleanFragment.startsWith("#") ? cleanFragment : `#${cleanFragment}`
          : "";
        const cleanAlias = alias.trim();
        const aliasPart = cleanAlias ? `|${cleanAlias}` : "";
        return `${linkKind === "embed" ? "!" : ""}[[${cleanTarget}${fragPart}${aliasPart}]]`;
      }

      if (mode === "callout") {
        const headerTitle = calloutTitle.trim() ? ` ${calloutTitle.trim()}` : "";
        const bodyLines = (calloutBody.trim() || "Details...")
          .split(/\r?\n/)
          .map((line) => (line.trim() ? `> ${line}` : ">"));
        return [`> [!${calloutType}]${calloutFold}${headerTitle}`, ...bodyLines].join("\n");
      }

      if (footnoteKind === "inline") {
        return `^[${footnoteText.trim() || "Inline footnote"}]`;
      }
      if (footnoteKind === "block") {
        const safeId = blockIdValue.trim().replace(/[^A-Za-z0-9-]/g, "-") || "block-id";
        return `^${safeId}`;
      }
      const safeFnId = footnoteId.trim().replace(/\s+/g, "-") || "1";
      return `[^${safeFnId}]`;
    };

    const insertSnippet = async () => {
      const snippet = buildSnippet();
      const doc = await context.editor.getDocument();
      if (!doc) {
        context.ui.showNotice("Open an editable note before inserting OFM syntax.");
        return;
      }

      if (mode === "footnote" && footnoteKind === "ref") {
        const safeFnId = footnoteId.trim().replace(/\s+/g, "-") || "1";
        const defText = `\n\n[^${safeFnId}]: ${footnoteText.trim() || "Footnote note."}`;
        await context.editor.insertAtCursor(snippet);
        const latestDoc = await context.editor.getDocument();
        if (latestDoc && !latestDoc.contentMarkdown.includes(`[^${safeFnId}]:`)) {
          const end = latestDoc.contentMarkdown.length;
          await context.editor.editMarkdown([{ from: end, to: end, insert: defText }]);
        }
      } else if (mode === "callout") {
        await context.editor.insertAtCursor(`\n${snippet}\n`);
      } else {
        await context.editor.insertAtCursor(snippet);
      }

      context.ui.showNotice("Inserted OFM syntax.");
      await panelContext.requestClose();
    };

    const render = () => {
      if (disposed) return;

      panelContext.shell.set({
        header: {
          title: "Insert Obsidian Flavored Markdown",
          description: "Build wikilinks, embeds, callouts, footnotes, or block IDs",
        },
        toolbar: [
          {
            type: "tabs",
            key: "mode",
            value: mode,
            options: [
              { value: "link", label: "Wikilink & Embed" },
              { value: "callout", label: "Callout Builder" },
              { value: "footnote", label: "Footnote & Block ID" },
            ],
          },
        ],
        onChange(key, value) {
          if (key === "mode" && (value === "link" || value === "callout" || value === "footnote")) {
            mode = value;
            render();
          }
        },
      });

      const noteOptions = notes
        .map((n) => `<option value="${escapeAttr(n.title)}">${escapeHtml(n.title)}</option>`)
        .join("");

      let fieldsHtml = "";
      if (mode === "link") {
        fieldsHtml = `
          <div class="ofm-field-row">
            <label class="ofm-field">
              <span class="ofm-label">Syntax Type</span>
              <select class="ofm-select" data-ofm-field="linkKind">
                <option value="link"${linkKind === "link" ? " selected" : ""}>Wikilink [[...]]</option>
                <option value="embed"${linkKind === "embed" ? " selected" : ""}>Embed ![[...]]</option>
              </select>
            </label>
            <label class="ofm-field">
              <span class="ofm-label">Target Note or Attachment</span>
              <input class="ofm-input" list="ofm-composer-notes" data-ofm-field="targetNote" value="${escapeAttr(targetNote)}" placeholder="Note Title or image.png" />
              <datalist id="ofm-composer-notes">${noteOptions}</datalist>
            </label>
          </div>
          <div class="ofm-field-row">
            <label class="ofm-field">
              <span class="ofm-label">Heading or ^block-id (optional)</span>
              <input class="ofm-input" data-ofm-field="fragment" value="${escapeAttr(fragment)}" placeholder="#Heading or #^block-id" />
            </label>
            <label class="ofm-field">
              <span class="ofm-label">Alias or Image Width (optional)</span>
              <input class="ofm-input" data-ofm-field="alias" value="${escapeAttr(alias)}" placeholder="Alias or 320" />
            </label>
          </div>
        `;
      } else if (mode === "callout") {
        const typeOpts = CALLOUT_TYPES.map(
          (t) => `<option value="${t}"${calloutType === t ? " selected" : ""}>${t}</option>`,
        ).join("");
        fieldsHtml = `
          <div class="ofm-field-row">
            <label class="ofm-field">
              <span class="ofm-label">Callout Type</span>
              <select class="ofm-select" data-ofm-field="calloutType">${typeOpts}</select>
            </label>
            <label class="ofm-field">
              <span class="ofm-label">Fold State</span>
              <select class="ofm-select" data-ofm-field="calloutFold">
                <option value=""${calloutFold === "" ? " selected" : ""}>Static (non-foldable)</option>
                <option value="+"${calloutFold === "+" ? " selected" : ""}>+ Expanded by default</option>
                <option value="-"${calloutFold === "-" ? " selected" : ""}>- Collapsed by default</option>
              </select>
            </label>
          </div>
          <label class="ofm-field">
            <span class="ofm-label">Title (optional)</span>
            <input class="ofm-input" data-ofm-field="calloutTitle" value="${escapeAttr(calloutTitle)}" placeholder="Leave blank for default callout title" />
          </label>
          <label class="ofm-field">
            <span class="ofm-label">Body</span>
            <textarea class="ofm-textarea" rows="3" data-ofm-field="calloutBody">${escapeHtml(calloutBody)}</textarea>
          </label>
        `;
      } else {
        fieldsHtml = `
          <label class="ofm-field">
            <span class="ofm-label">Insert Type</span>
            <select class="ofm-select" data-ofm-field="footnoteKind">
              <option value="ref"${footnoteKind === "ref" ? " selected" : ""}>Footnote Reference [^id] + Definition</option>
              <option value="inline"${footnoteKind === "inline" ? " selected" : ""}>Inline Footnote ^[text]</option>
              <option value="block"${footnoteKind === "block" ? " selected" : ""}>Block Anchor ^block-id</option>
            </select>
          </label>
          ${footnoteKind === "ref" ? `
            <label class="ofm-field">
              <span class="ofm-label">Footnote ID</span>
              <input class="ofm-input" data-ofm-field="footnoteId" value="${escapeAttr(footnoteId)}" />
            </label>
          ` : ""}
          ${footnoteKind === "block" ? `
            <label class="ofm-field">
              <span class="ofm-label">Block ID</span>
              <input class="ofm-input" data-ofm-field="blockIdValue" value="${escapeAttr(blockIdValue)}" />
            </label>
          ` : `
            <label class="ofm-field">
              <span class="ofm-label">Footnote Text</span>
              <textarea class="ofm-textarea" rows="2" data-ofm-field="footnoteText">${escapeHtml(footnoteText)}</textarea>
            </label>
          `}
        `;
      }

      container.innerHTML = `
        ${fieldsHtml}
        <div class="ofm-field">
          <span class="ofm-label">Markdown Preview</span>
          <pre class="ofm-preview-code" data-ofm-preview></pre>
        </div>
        <div class="ofm-actions-row">
          <button type="button" class="ofm-btn" data-ofm-cancel>Cancel</button>
          <button type="button" class="ofm-btn ofm-btn-primary" data-ofm-insert>Insert into Note</button>
        </div>
      `;

      const previewEl = container.querySelector<HTMLElement>("[data-ofm-preview]");
      if (previewEl) previewEl.textContent = buildSnippet();
    };

    const onInput = (event: Event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!target) return;
      const field = target.getAttribute("data-ofm-field");
      if (!field) return;
      const val = target.value;

      if (field === "linkKind") linkKind = val === "embed" ? "embed" : "link";
      else if (field === "targetNote") targetNote = val;
      else if (field === "fragment") fragment = val;
      else if (field === "alias") alias = val;
      else if (field === "calloutType") calloutType = val;
      else if (field === "calloutFold") calloutFold = val === "+" || val === "-" ? val : "";
      else if (field === "calloutTitle") calloutTitle = val;
      else if (field === "calloutBody") calloutBody = val;
      else if (field === "footnoteKind") {
        footnoteKind = val === "inline" || val === "block" ? val : "ref";
        render();
        return;
      } else if (field === "footnoteId") footnoteId = val;
      else if (field === "footnoteText") footnoteText = val;
      else if (field === "blockIdValue") blockIdValue = val;

      const previewEl = container.querySelector<HTMLElement>("[data-ofm-preview]");
      if (previewEl) previewEl.textContent = buildSnippet();
    };

    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-ofm-cancel]")) {
        void panelContext.requestClose();
        return;
      }
      if (target.closest("[data-ofm-insert]")) {
        void insertSnippet().catch((err) => {
          context.ui.showNotice(err instanceof Error ? err.message : String(err));
        });
      }
    };

    container.addEventListener("input", onInput);
    container.addEventListener("change", onInput);
    container.addEventListener("click", onClick);
    render();

    return () => {
      disposed = true;
      container.removeEventListener("input", onInput);
      container.removeEventListener("change", onInput);
      container.removeEventListener("click", onClick);
      container.replaceChildren();
    };
  },
});
