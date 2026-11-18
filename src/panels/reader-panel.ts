import type { PluginContext, PluginPanel, PluginPanelMountContext } from "@edgeever/plugin-api";
import { formatWikilinkLabel } from "../ofm-parser.ts";
import { renderOfmIntoElement } from "../ofm-renderer.ts";
import { escapeAttr, escapeHtml } from "../sanitizer.ts";
import type { SettingsController } from "../settings.ts";
import type { WorkspaceNoteIndex } from "../workspace-index.ts";

type ReaderTab = "reader" | "backlinks" | "links" | "guide";

const SYNTAX_GUIDE_MARKDOWN = `# Obsidian Flavored Markdown Reference

> [!tip]+ Quick Reference
> All syntax below is supported in the **OFM Reader** and insertion commands.

## Links & Embeds
- Internal link: \`[[Note Title]]\` or \`[[Note Title|Display Alias]]\`
- Heading & block links: \`[[Note Title#Heading]]\`, \`[[Note Title#^block-id]]\`
- Embeds: \`![[Note Title]]\`, \`![[Note Title#Heading]]\`, \`![[Note Title#^block-id]]\`
- Image sizing: \`![[diagram.png|320]]\` or \`![[diagram.png|320x180]]\`

## Highlights, Comments & Footnotes
- Highlight: ==important phrase==
- Strikethrough: ~~deprecated text~~
- Comment (hidden by default): %%private author note%%
- Footnote: Reference[^guide-1] and inline^[Inline footnote example].

[^guide-1]: Footnote definition supporting **formatted** text.

## Callouts & Tasks
> [!note] Standard Note Callout
> Supports nested callouts, lists, math, and wikilinks.

> [!warning]- Collapsed by default
> Use \`> [!type]-\` for collapsed or \`> [!type]+\` for expanded callouts.

- [x] CommonMark & GitHub Flavored Markdown
- [ ] Interactive task toggling in OFM Reader ^guide-task

## LaTeX & Strict HTML
Inline math $E = mc^2$ and currency like $100 remain distinct.

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

<div>
This **will not** be bold because Obsidian ignores Markdown inside HTML elements.
</div>
`;

export const createReaderPanel = (
  context: PluginContext,
  index: WorkspaceNoteIndex,
  settingsController: SettingsController,
): PluginPanel => ({
  id: "ofm-reader",
  title: "OFM Reader & Links",
  purpose: "preview",
  presentation: "fullscreen",
  async mount(container: HTMLElement, panelContext: PluginPanelMountContext) {
    let activeTab: ReaderTab = "reader";
    let searchQuery = "";
    let explicitNoteId: string | null = null;
    let disposeRender: (() => void) | null = null;
    let disposed = false;

    const initialState = panelContext.state;
    if (initialState && typeof initialState === "object" && !Array.isArray(initialState)) {
      const stateObj = initialState as Record<string, unknown>;
      if (stateObj.tab === "reader" || stateObj.tab === "backlinks" || stateObj.tab === "links" || stateObj.tab === "guide") {
        activeTab = stateObj.tab;
      }
      if (typeof stateObj.noteId === "string" && stateObj.noteId) {
        explicitNoteId = stateObj.noteId;
      }
    }

    container.className = "ofm-root";

    const resolveTargetNote = async (): Promise<{
      noteId: string | null;
      title: string;
      markdown: string;
      hasUnsavedChanges: boolean;
      sourceKind: "editor" | "workspace" | "empty";
    }> => {
      const editorDoc = await context.editor.getDocument();
      if (explicitNoteId && (!editorDoc || editorDoc.noteId !== explicitNoteId)) {
        const stored = index.getNoteById(explicitNoteId) ?? await context.notes.get(explicitNoteId).catch(() => null);
        if (stored) {
          return {
            noteId: stored.id,
            title: stored.title || "Untitled",
            markdown: stored.contentMarkdown,
            hasUnsavedChanges: false,
            sourceKind: "workspace",
          };
        }
      }

      if (editorDoc) {
        const stored = index.getNoteById(editorDoc.noteId);
        const title = stored?.title ?? (await context.notes.get(editorDoc.noteId).catch(() => null))?.title ?? "Active Note";
        index.upsertLiveDocument(editorDoc.noteId, editorDoc.contentMarkdown, title);
        return {
          noteId: editorDoc.noteId,
          title,
          markdown: editorDoc.contentMarkdown,
          hasUnsavedChanges: editorDoc.hasUnsavedChanges,
          sourceKind: "editor",
        };
      }

      const recent = await context.notes.query({ sort: "updated-desc", limit: 10 });
      const firstText = recent.notes.find((n) => n.kind === "text");
      if (firstText) {
        const full = await context.notes.get(firstText.id);
        return {
          noteId: full.id,
          title: full.title || "Untitled",
          markdown: full.contentMarkdown,
          hasUnsavedChanges: false,
          sourceKind: "workspace",
        };
      }

      return {
        noteId: null,
        title: "No Note Selected",
        markdown: "",
        hasUnsavedChanges: false,
        sourceKind: "empty",
      };
    };

    const renderView = async () => {
      if (disposed) return;
      disposeRender?.();
      disposeRender = null;

      await index.ensureLoaded();
      if (disposed) return;

      const settings = settingsController.get();
      const target = await resolveTargetNote();
      if (disposed) return;

      const isEmpty = activeTab !== "guide" && target.sourceKind === "empty";

      panelContext.shell.set({
        header: {
          title: activeTab === "guide" ? "OFM Syntax Guide" : target.title,
          description: activeTab === "guide"
            ? "Obsidian Flavored Markdown compatibility overview"
            : target.hasUnsavedChanges
              ? "Live preview (includes unsaved editor changes)"
              : "Obsidian Flavored Markdown preview & link inspector",
          actions: [
            { id: "refresh", label: "Refresh" },
            { id: "openComposer", label: "Insert OFM", variant: "primary" },
          ],
        },
        toolbar: [
          {
            type: "tabs",
            key: "tab",
            value: activeTab,
            options: [
              { value: "reader", label: "Reader" },
              { value: "backlinks", label: "Backlinks" },
              { value: "links", label: "Links & Blocks" },
              { value: "guide", label: "OFM Syntax" },
            ],
          },
          {
            type: "search",
            key: "q",
            placeholder: activeTab === "reader" ? "Filter view or search..." : "Filter links, blocks, mentions...",
            value: searchQuery,
          },
        ],
        empty: isEmpty
          ? {
              title: "No Markdown note available",
              description: "Open or create a text note to preview Obsidian Flavored Markdown syntax.",
              action: { id: "showGuide", label: "View OFM Syntax Guide", variant: "primary" },
            }
          : null,
        onAction(actionId) {
          if (actionId === "refresh") {
            void index.refresh(true).then(() => renderView());
          } else if (actionId === "openComposer") {
            void context.ui.panels.open("ofm-composer");
          } else if (actionId === "showGuide") {
            activeTab = "guide";
            void renderView();
          }
        },
        onChange(key, value) {
          if (key === "tab" && (value === "reader" || value === "backlinks" || value === "links" || value === "guide")) {
            activeTab = value;
            void renderView();
          } else if (key === "q") {
            searchQuery = value;
            void renderView();
          }
        },
      });

      if (isEmpty) {
        container.replaceChildren();
        return;
      }

      if (activeTab === "reader" || activeTab === "guide") {
        const wrapper = document.createElement("div");
        wrapper.className = "ofm-reader-layout";

        const markdownToRender = activeTab === "guide" ? SYNTAX_GUIDE_MARKDOWN : target.markdown;
        const bodyHost = document.createElement("div");

        const result = await renderOfmIntoElement(bodyHost, {
          context,
          index,
          settings,
          noteId: activeTab === "guide" ? null : target.noteId,
          noteTitle: activeTab === "guide" ? "OFM Guide" : target.title,
          markdown: markdownToRender,
          onNavigateNote: async (nextId, search) => {
            explicitNoteId = nextId;
            await context.ui.openNote(nextId, search ? { search } : undefined);
            if (!disposed) {
              await renderView();
            }
          },
          onNoteMutated: async () => {
            await index.refresh(true);
          },
        });
        if (disposed) {
          result.dispose();
          return;
        }
        disposeRender = result.dispose;

        if (activeTab === "reader" && target.noteId) {
          const backlinks = index.getBacklinks(target.noteId, target.title);
          const banner = document.createElement("div");
          banner.className = "ofm-note-banner";
          banner.innerHTML = `<span class="ofm-note-banner-title">${escapeHtml(target.title)}</span><div class="ofm-note-banner-meta"><span class="ofm-pill">${result.parsed.links.length} outgoing</span><span class="ofm-pill">${backlinks.linked.length} backlinks</span><span class="ofm-pill">${Object.keys(result.parsed.blocks).length} blocks</span><span class="ofm-pill">${result.parsed.tasks.length} tasks</span></div>`;
          wrapper.append(banner);
        }

        wrapper.append(bodyHost);
        container.replaceChildren(wrapper);
        return;
      }

      const needle = searchQuery.trim().toLowerCase();

      if (activeTab === "backlinks" && target.noteId) {
        const { linked, unlinked } = index.getBacklinks(target.noteId, target.title);
        const filteredLinked = linked.filter(
          (item) => !needle || item.noteTitle.toLowerCase().includes(needle) || item.snippet.toLowerCase().includes(needle),
        );
        const filteredUnlinked = unlinked.filter(
          (item) => !needle || item.noteTitle.toLowerCase().includes(needle) || item.snippet.toLowerCase().includes(needle),
        );

        const list = document.createElement("div");
        list.className = "ofm-section-list";

        const linkedHeading = document.createElement("h3");
        linkedHeading.textContent = `Linked Mentions (${filteredLinked.length})`;
        list.append(linkedHeading);

        if (!filteredLinked.length) {
          const emptyCard = document.createElement("div");
          emptyCard.className = "ofm-card";
          emptyCard.textContent = "No notes link to this note yet via [[Wikilinks]] or #memo links.";
          list.append(emptyCard);
        } else {
          for (const item of filteredLinked) {
            const card = document.createElement("div");
            card.className = "ofm-card";
            card.innerHTML = `<div class="ofm-card-header"><span class="ofm-card-title">${escapeHtml(item.noteTitle)} (Line ${item.line})</span><button type="button" class="ofm-btn" data-ofm-jump-note="${escapeAttr(item.noteId)}" data-ofm-jump-query="${escapeAttr(item.snippet)}">Open</button></div><div class="ofm-card-excerpt">${escapeHtml(item.snippet)}</div>`;
            list.append(card);
          }
        }

        const unlinkedHeading = document.createElement("h3");
        unlinkedHeading.textContent = `Unlinked Mentions (${filteredUnlinked.length})`;
        list.append(unlinkedHeading);

        if (!filteredUnlinked.length) {
          const emptyUnlinked = document.createElement("div");
          emptyUnlinked.className = "ofm-card";
          emptyUnlinked.textContent = "No unlinked title mentions found.";
          list.append(emptyUnlinked);
        } else {
          for (const item of filteredUnlinked) {
            const card = document.createElement("div");
            card.className = "ofm-card";
            card.innerHTML = `<div class="ofm-card-header"><span class="ofm-card-title">${escapeHtml(item.noteTitle)} (Line ${item.line})</span><button type="button" class="ofm-btn" data-ofm-jump-note="${escapeAttr(item.noteId)}" data-ofm-jump-query="${escapeAttr(item.snippet)}">Open</button></div><div class="ofm-card-excerpt">${escapeHtml(item.snippet)}</div>`;
            list.append(card);
          }
        }

        const onClick = (event: Event) => {
          const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-ofm-jump-note]");
          if (!btn) return;
          const jumpId = btn.getAttribute("data-ofm-jump-note");
          const query = btn.getAttribute("data-ofm-jump-query") || undefined;
          if (jumpId) {
            explicitNoteId = jumpId;
            void context.ui.openNote(jumpId, query ? { search: query.slice(0, 120) } : undefined).then(() => renderView());
          }
        };
        list.addEventListener("click", onClick);
        disposeRender = () => list.removeEventListener("click", onClick);
        container.replaceChildren(list);
        return;
      }

      if (activeTab === "links" && target.noteId) {
        const structure = index.getNoteStructure(target.noteId);
        const list = document.createElement("div");
        list.className = "ofm-section-list";

        const outgoingFiltered = structure.outgoing.filter((item) => {
          if (!needle) return true;
          return item.ref.raw.toLowerCase().includes(needle) || formatWikilinkLabel(item.ref).toLowerCase().includes(needle);
        });

        const outgoingTitle = document.createElement("h3");
        outgoingTitle.textContent = `Outgoing Links & Embeds (${outgoingFiltered.length})`;
        list.append(outgoingTitle);

        if (!outgoingFiltered.length) {
          const card = document.createElement("div");
          card.className = "ofm-card";
          card.textContent = "No outgoing [[Wikilinks]] or ![[Embeds]] in this note.";
          list.append(card);
        } else {
          for (const item of outgoingFiltered) {
            const card = document.createElement("div");
            card.className = "ofm-card";
            const statusText = item.resolved ? "Resolved" : "Unresolved";
            const actionHtml = item.resolved
              ? `<button type="button" class="ofm-btn" data-ofm-jump-note="${escapeAttr(item.resolved.id)}">Open</button>`
              : `<span class="ofm-pill">${statusText}</span>`;
            card.innerHTML = `<div class="ofm-card-header"><span class="ofm-card-title">${escapeHtml(item.ref.raw)}</span>${actionHtml}</div><div class="ofm-card-excerpt">${escapeHtml(item.ref.isEmbed ? "Embed" : "Wikilink")} · ${escapeHtml(statusText)}</div>`;
            list.append(card);
          }
        }

        const blocksFiltered = structure.blocks.filter(
          (b) => !needle || b.id.toLowerCase().includes(needle) || b.markdown.toLowerCase().includes(needle),
        );
        const blocksTitle = document.createElement("h3");
        blocksTitle.textContent = `Block Anchors (^id) (${blocksFiltered.length})`;
        list.append(blocksTitle);

        if (!blocksFiltered.length) {
          const card = document.createElement("div");
          card.className = "ofm-card";
          card.textContent = "No ^block-id anchors defined in this note.";
          list.append(card);
        } else {
          for (const block of blocksFiltered) {
            const card = document.createElement("div");
            card.className = "ofm-card";
            const refSyntax = `[[${target.title}#^${block.id}]]`;
            card.innerHTML = `<div class="ofm-card-header"><span class="ofm-card-title">^${escapeHtml(block.id)} (Line ${block.line})</span><button type="button" class="ofm-btn" data-ofm-copy-ref="${escapeAttr(refSyntax)}">Copy ${escapeHtml(refSyntax)}</button></div><div class="ofm-card-excerpt">${escapeHtml(block.markdown || "(Standalone block anchor)")}</div>`;
            list.append(card);
          }
        }

        const onClick = (event: Event) => {
          const targetEl = event.target as HTMLElement | null;
          const jumpBtn = targetEl?.closest<HTMLElement>("[data-ofm-jump-note]");
          if (jumpBtn) {
            const jumpId = jumpBtn.getAttribute("data-ofm-jump-note");
            if (jumpId) {
              explicitNoteId = jumpId;
              void context.ui.openNote(jumpId).then(() => renderView());
            }
            return;
          }
          const copyBtn = targetEl?.closest<HTMLElement>("[data-ofm-copy-ref]");
          if (copyBtn) {
            const refText = copyBtn.getAttribute("data-ofm-copy-ref");
            if (refText) {
              void navigator.clipboard?.writeText(refText).catch(() => undefined);
              context.ui.showNotice(`Copied ${refText}`);
            }
          }
        };
        list.addEventListener("click", onClick);
        disposeRender = () => list.removeEventListener("click", onClick);
        container.replaceChildren(list);
      }
    };

    const disposeSettings = settingsController.subscribe(() => {
      void renderView();
    });
    const disposeIndex = index.subscribe(() => {
      if (activeTab === "backlinks" || activeTab === "links") {
        void renderView();
      }
    });

    await renderView();

    return () => {
      disposed = true;
      disposeSettings();
      disposeIndex();
      disposeRender?.();
      disposeRender = null;
      container.replaceChildren();
    };
  },
});
