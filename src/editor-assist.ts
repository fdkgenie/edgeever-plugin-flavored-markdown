import type { PluginContext } from "@edgeever/plugin-api";
import { parseWikilinkInner } from "./ofm-parser.ts";
import { escapeHtml } from "./sanitizer.ts";
import type { SettingsController } from "./settings.ts";
import type { AutocompleteSuggestion, WorkspaceNoteIndex } from "./workspace-index.ts";

const findWikilinkAtOffset = (text: string, offset: number): string | null => {
  const before = text.slice(0, offset);
  const openIdx = before.lastIndexOf("[[");
  if (openIdx === -1) return null;
  if (before.lastIndexOf("]]") > openIdx) return null;
  const closeIdx = text.indexOf("]]", openIdx + 2);
  if (closeIdx === -1 || closeIdx < offset) return null;
  return text.slice(openIdx + 2, closeIdx);
};

export const createEditorAssist = (
  context: PluginContext,
  index: WorkspaceNoteIndex,
  settingsController: SettingsController,
): (() => void) => {
  if (typeof document === "undefined") {
    return () => {};
  }

  let popover: HTMLDivElement | null = null;
  let suggestions: AutocompleteSuggestion[] = [];
  let selectedIndex = 0;
  let activeQueryLength = 0;
  let activeRange: Range | null = null;
  let activeTextarea: HTMLTextAreaElement | null = null;

  const closePopover = () => {
    if (popover) {
      popover.remove();
      popover = null;
    }
    suggestions = [];
    selectedIndex = 0;
    activeQueryLength = 0;
    activeRange = null;
    activeTextarea = null;
  };

  const openTargetNote = async (rawInner: string) => {
    const ref = parseWikilinkInner(rawInner, false);
    if (!ref.target) {
      if (ref.heading || ref.blockId) {
        const doc = await context.editor.getDocument();
        if (doc) {
          await context.ui.openNote(doc.noteId, { search: ref.blockId ? `^${ref.blockId}` : ref.heading });
        }
      }
      return;
    }

    await index.ensureLoaded();
    const resolved = index.resolveNoteTarget(ref.target);
    if (resolved) {
      const search = ref.blockId ? `^${ref.blockId}` : ref.heading;
      await context.ui.openNote(resolved.id, search ? { search } : undefined);
      return;
    }

    if (settingsController.get().missingNoteAction === "create") {
      const notebookId = index.getDefaultNotebookId();
      if (!notebookId) {
        context.ui.showNotice(`Cannot create "${ref.target}": no notebook available.`);
        return;
      }
      const created = await context.notes.create({
        notebookId,
        title: ref.target,
        contentMarkdown: `# ${ref.target}\n\n`,
      });
      await index.refresh(true);
      context.ui.showNotice(`Created note "${created.title || ref.target}".`);
      await context.ui.openNote(created.id);
    } else {
      context.ui.showNotice(`Note "${ref.target}" does not exist.`);
    }
  };

  const applySuggestion = async (item: AutocompleteSuggestion) => {
    const completion = `${item.insertText}]]`;

    if (activeTextarea) {
      const ta = activeTextarea;
      const end = ta.selectionStart ?? 0;
      const start = Math.max(0, end - activeQueryLength);
      const nextValue = `${ta.value.slice(0, start)}${completion}${ta.value.slice(end)}`;
      ta.value = nextValue;
      const nextCaret = start + completion.length;
      ta.setSelectionRange(nextCaret, nextCaret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      closePopover();
      return;
    }

    if (activeRange && typeof window !== "undefined") {
      const sel = window.getSelection?.();
      if (sel && activeRange.startContainer.nodeType === 3) {
        const node = activeRange.startContainer as Text;
        const endOffset = activeRange.startOffset;
        const startOffset = Math.max(0, endOffset - activeQueryLength);
        const replaceRange = document.createRange();
        replaceRange.setStart(node, startOffset);
        replaceRange.setEnd(node, endOffset);
        sel.removeAllRanges();
        sel.addRange(replaceRange);
        const insertedByExec = typeof document.execCommand === "function"
          ? document.execCommand("insertText", false, completion)
          : false;
        if (insertedByExec) {
          closePopover();
          return;
        }
      }
    }

    const suffix = completion.slice(activeQueryLength);
    closePopover();
    await context.editor.insertAtCursor(suffix || completion);
  };

  const renderPopover = (rect: { left: number; bottom: number; top: number }) => {
    if (!suggestions.length) {
      closePopover();
      return;
    }

    if (!popover) {
      popover = document.createElement("div");
      popover.className = "ofm-autocomplete-popover";
      popover.setAttribute("role", "listbox");
      popover.setAttribute("aria-label", "Wikilink suggestions");
      popover.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-ofm-suggest-index]");
        if (!btn) return;
        const idx = Number(btn.getAttribute("data-ofm-suggest-index"));
        const chosen = suggestions[idx];
        if (chosen) void applySuggestion(chosen);
      });
      document.body.append(popover);
    }

    const maxLeft = Math.max(12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 376);
    const left = Math.min(Math.max(12, rect.left), maxLeft);
    const viewHeight = typeof window !== "undefined" ? window.innerHeight : 768;
    const top = rect.bottom + 240 > viewHeight ? Math.max(12, rect.top - 240) : rect.bottom + 6;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    popover.innerHTML = suggestions
      .map(
        (item, idx) =>
          `<button type="button" class="ofm-autocomplete-item" role="option" aria-selected="${idx === selectedIndex ? "true" : "false"}" data-ofm-suggest-index="${idx}"><span>${escapeHtml(item.label)}</span><span class="ofm-autocomplete-kind">${escapeHtml(item.detail)}</span></button>`,
      )
      .join("");
  };

  const inspectCaretForAutocomplete = async () => {
    if (!settingsController.get().editorWikilinkAutocomplete) {
      closePopover();
      return;
    }

    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || !activeEl.closest(".edgeever-editor")) {
      closePopover();
      return;
    }

    let textBefore = "";
    let rect: { left: number; bottom: number; top: number } | null = null;
    activeRange = null;
    activeTextarea = null;

    if (activeEl instanceof HTMLTextAreaElement) {
      const caret = activeEl.selectionStart ?? 0;
      textBefore = activeEl.value.slice(0, caret);
      activeTextarea = activeEl;
      const box = activeEl.getBoundingClientRect();
      rect = { left: box.left + 16, top: box.top + 16, bottom: box.top + 40 };
    } else {
      const sel = window.getSelection?.();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) {
        closePopover();
        return;
      }
      const range = sel.getRangeAt(0);
      if (range.startContainer.nodeType !== 3) {
        closePopover();
        return;
      }
      activeRange = range.cloneRange();
      const textNode = range.startContainer as Text;
      textBefore = (textNode.textContent ?? "").slice(0, range.startOffset);
      const box = range.getBoundingClientRect();
      rect = box.width || box.height ? box : (textNode.parentElement?.getBoundingClientRect() ?? null);
    }

    const match = /\[\[([^\]\r\n]*)$/.exec(textBefore);
    if (!match || !rect) {
      closePopover();
      return;
    }

    const query = match[1]!;
    activeQueryLength = query.length;
    await index.ensureLoaded();
    const doc = await context.editor.getDocument();
    if (doc) {
      index.upsertLiveDocument(doc.noteId, doc.contentMarkdown);
    }
    suggestions = index.searchSuggestions(query, doc?.noteId ?? null);
    selectedIndex = 0;
    renderPopover(rect);
  };

  const handleClick = (event: MouseEvent) => {
    if (!settingsController.get().editorCtrlClickOpen) return;
    if (!event.metaKey && !event.ctrlKey) return;
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest(".edgeever-editor") || target.closest(".ofm-root")) return;

    let candidateInner: string | null = null;
    const docWithCaret = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const range = docWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && range.startContainer.nodeType === 3) {
      candidateInner = findWikilinkAtOffset(range.startContainer.textContent ?? "", range.startOffset);
    }

    if (!candidateInner) {
      const text = target.textContent ?? "";
      const m = /\[\[([^\]\r\n]+)\]\]/.exec(text);
      if (m) candidateInner = m[1]!;
    }

    if (!candidateInner) return;
    event.preventDefault();
    event.stopPropagation();
    void openTargetNote(candidateInner);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!popover || !suggestions.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % suggestions.length;
      const chosen = popover.querySelectorAll<HTMLElement>("[data-ofm-suggest-index]");
      chosen.forEach((el, idx) => el.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false"));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = (selectedIndex + suggestions.length - 1) % suggestions.length;
      const chosen = popover.querySelectorAll<HTMLElement>("[data-ofm-suggest-index]");
      chosen.forEach((el, idx) => el.setAttribute("aria-selected", idx === selectedIndex ? "true" : "false"));
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const chosen = suggestions[selectedIndex];
      if (chosen) {
        event.preventDefault();
        event.stopPropagation();
        void applySuggestion(chosen);
      }
    }
  };

  const handleInputOrKeyUp = (event: Event) => {
    if (event instanceof KeyboardEvent && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      return;
    }
    void inspectCaretForAutocomplete();
  };

  const handleOutsideMouseDown = (event: MouseEvent) => {
    if (!popover) return;
    const target = event.target as Node | null;
    if (target && !popover.contains(target)) {
      closePopover();
    }
  };

  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleInputOrKeyUp);
  document.addEventListener("input", handleInputOrKeyUp);
  document.addEventListener("mousedown", handleOutsideMouseDown);

  return () => {
    closePopover();
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("keyup", handleInputOrKeyUp);
    document.removeEventListener("input", handleInputOrKeyUp);
    document.removeEventListener("mousedown", handleOutsideMouseDown);
  };
};
