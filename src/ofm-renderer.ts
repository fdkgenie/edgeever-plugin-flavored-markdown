import type { PluginContext, PluginResource } from "@edgeever/plugin-api";
import {
  extractBlockMarkdown,
  extractHeadingSection,
  formatWikilinkLabel,
  parseOfmDocument,
  splitFrontmatter,
} from "./ofm-parser.ts";
import { escapeAttr, escapeHtml } from "./sanitizer.ts";
import type { OfmSettings, ParsedOfmDocument, WikilinkRef } from "./types.ts";
import type { WorkspaceNoteIndex } from "./workspace-index.ts";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);

const getFileExtension = (name: string): string => {
  const clean = name.split(/[?#]/)[0] ?? name;
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot + 1).toLowerCase();
};

const isMediaTarget = (target: string): boolean => {
  const ext = getFileExtension(target);
  return IMAGE_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext) || ext === "pdf";
};

const renderFrontmatterHtml = (parsed: ParsedOfmDocument): string => {
  if (!parsed.frontmatter.length) return "";
  const rows = parsed.frontmatter
    .map(
      (entry) =>
        `<div class="ofm-frontmatter-key">${escapeHtml(entry.key)}</div><div class="ofm-frontmatter-value">${escapeHtml(entry.value)}</div>`,
    )
    .join("");
  return `<details class="ofm-frontmatter"><summary>Properties (${parsed.frontmatter.length})</summary><div class="ofm-frontmatter-grid">${rows}</div></details>`;
};

export interface RenderOfmControllerOptions {
  context: PluginContext;
  index: WorkspaceNoteIndex;
  settings: OfmSettings;
  noteId: string | null;
  noteTitle: string;
  markdown: string;
  onNavigateNote?: (targetNoteId: string, search?: string) => Promise<void> | void;
  onNoteMutated?: () => Promise<void> | void;
}

export const renderOfmIntoElement = async (
  container: HTMLElement,
  options: RenderOfmControllerOptions,
): Promise<{ parsed: ParsedOfmDocument; dispose: () => void }> => {
  const { context, index, settings, noteId, noteTitle, markdown } = options;
  const objectUrls: string[] = [];
  let disposed = false;

  const parsed = parseOfmDocument(markdown, {
    settings,
    isResolvedLink: (ref) => {
      if (!ref.target) return true;
      return Boolean(index.resolveNoteTarget(ref.target));
    },
  });

  const article = document.createElement("article");
  article.className = "ofm-article";
  article.innerHTML = `${renderFrontmatterHtml(parsed)}${parsed.html}`;
  container.replaceChildren(article);

  let cachedResources: PluginResource[] | null = null;
  const getResources = async (): Promise<PluginResource[]> => {
    if (cachedResources) return cachedResources;
    try {
      const noteResources = noteId ? await context.resources.list(noteId) : [];
      const allResources = await context.resources.list().catch(() => []);
      const seen = new Set<string>();
      const merged: PluginResource[] = [];
      for (const item of [...noteResources, ...allResources]) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
      }
      cachedResources = merged;
      return merged;
    } catch {
      return [];
    }
  };

  const findMatchingResource = async (target: string): Promise<PluginResource | null> => {
    const cleaned = target.trim().toLowerCase();
    const baseName = cleaned.split("/").pop() ?? cleaned;
    const resources = await getResources();
    return (
      resources.find((r) => (r.filename ?? "").toLowerCase() === cleaned)
      ?? resources.find((r) => (r.filename ?? "").toLowerCase() === baseName)
      ?? resources.find((r) => r.id === target.trim())
      ?? null
    );
  };

  const resolveEmbedSlots = async (
    rootEl: Element,
    currentNoteId: string | null,
    currentMarkdown: string,
    depth: number,
    ancestors: ReadonlySet<string>,
  ): Promise<void> => {
    if (disposed) return;
    const slots = [...rootEl.querySelectorAll<HTMLElement>("[data-ofm-embed]")];
    for (const slot of slots) {
      if (disposed) return;
      const rawJson = slot.getAttribute("data-ofm-embed");
      if (!rawJson) continue;
      let ref: WikilinkRef;
      try {
        ref = JSON.parse(rawJson) as WikilinkRef;
      } catch {
        continue;
      }

      const targetName = ref.target.trim();
      const matchedResource = targetName ? await findMatchingResource(targetName) : null;
      if (disposed) return;

      if (matchedResource) {
        try {
          const blob = await context.resources.read(matchedResource.id);
          if (disposed) return;
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.push(objectUrl);
          const mediaWrap = document.createElement("div");
          mediaWrap.className = "ofm-embed-media";
          const ext = getFileExtension(matchedResource.filename ?? targetName);
          const mime = (matchedResource.mimeType ?? "").toLowerCase();

          if (matchedResource.kind === "image" || mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
            const img = document.createElement("img");
            img.src = objectUrl;
            img.alt = ref.alias ?? matchedResource.filename ?? targetName;
            if (ref.width) img.style.width = `${ref.width}px`;
            if (ref.height) img.style.height = `${ref.height}px`;
            mediaWrap.append(img);
          } else if (mime.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) {
            const audio = document.createElement("audio");
            audio.controls = true;
            audio.src = objectUrl;
            mediaWrap.append(audio);
          } else if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
            const video = document.createElement("video");
            video.controls = true;
            video.src = objectUrl;
            if (ref.width) video.style.width = `${ref.width}px`;
            mediaWrap.append(video);
          } else {
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = matchedResource.filename ?? targetName;
            link.className = "ofm-btn";
            link.textContent = `Attachment: ${matchedResource.filename ?? targetName}`;
            mediaWrap.append(link);
          }

          slot.replaceChildren(mediaWrap);
          continue;
        } catch {
          slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-body ofm-embed-error">Unable to load media: ${escapeHtml(targetName)}</div></div>`;
          continue;
        }
      }

      if (targetName && isMediaTarget(targetName)) {
        slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-body ofm-embed-empty">Media attachment not found in workspace: ${escapeHtml(targetName)}</div></div>`;
        continue;
      }

      const targetNote = targetName
        ? index.resolveNoteTarget(targetName)
        : (currentNoteId ? index.getNoteById(currentNoteId) : null);

      const targetMarkdown = targetNote?.contentMarkdown ?? (!targetName ? currentMarkdown : null);
      const targetId = targetNote?.id ?? (!targetName ? currentNoteId : null);
      const displayTitle = targetNote?.title ?? (targetName || noteTitle || "Current Note");

      if (targetMarkdown === null) {
        slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-header"><span>${escapeHtml(formatWikilinkLabel(ref))}</span></div><div class="ofm-embed-body ofm-embed-empty">Note not found: ${escapeHtml(targetName)}</div></div>`;
        continue;
      }

      if (targetId && targetName && ancestors.has(targetId)) {
        slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-header"><span>${escapeHtml(displayTitle)}</span></div><div class="ofm-embed-body ofm-embed-error">Circular embed detected for [[${escapeHtml(displayTitle)}]].</div></div>`;
        continue;
      }

      if (depth >= settings.readerMaxEmbedDepth) {
        slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-header"><span>${escapeHtml(displayTitle)}</span></div><div class="ofm-embed-body ofm-embed-empty">Max embed depth (${settings.readerMaxEmbedDepth}) reached.</div></div>`;
        continue;
      }

      let slice: string | null = splitFrontmatter(targetMarkdown).body;
      if (ref.blockId) {
        slice = extractBlockMarkdown(targetMarkdown, ref.blockId);
      } else if (ref.heading) {
        slice = extractHeadingSection(targetMarkdown, ref.heading);
      }

      if (slice === null || !slice.trim()) {
        const missingTarget = ref.blockId ? `^${ref.blockId}` : `#${ref.heading ?? ""}`;
        slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-header"><span>${escapeHtml(displayTitle)}</span></div><div class="ofm-embed-body ofm-embed-empty">Referenced section not found: ${escapeHtml(missingTarget)}</div></div>`;
        continue;
      }

      const nestedParsed = parseOfmDocument(slice, {
        settings,
        isResolvedLink: (nestedRef) => !nestedRef.target || Boolean(index.resolveNoteTarget(nestedRef.target)),
      });

      const headerTitle = ref.heading
        ? `${displayTitle} › ${ref.heading}`
        : ref.blockId
          ? `${displayTitle} › ^${ref.blockId}`
          : displayTitle;

      const openButton = targetId
        ? `<button type="button" class="ofm-embed-open" data-ofm-open-note="${escapeAttr(targetId)}" data-ofm-open-search="${escapeAttr(ref.heading ?? ref.blockId ?? "")}">Open</button>`
        : "";

      slot.innerHTML = `<div class="ofm-embed-card"><div class="ofm-embed-header"><span>${escapeHtml(headerTitle)}</span>${openButton}</div><div class="ofm-embed-body">${nestedParsed.html}</div></div>`;

      const nextAncestors = new Set(ancestors);
      if (targetId) nextAncestors.add(targetId);
      await resolveEmbedSlots(slot, targetId, targetMarkdown, depth + 1, nextAncestors);
    }
  };

  const initialAncestors = new Set<string>();
  if (noteId) initialAncestors.add(noteId);
  await resolveEmbedSlots(article, noteId, markdown, 0, initialAncestors);

  const openOrCreateWikilink = async (ref: WikilinkRef) => {
    if (!ref.target) {
      const targetId = ref.blockId
        ? `ofm-block-${ref.blockId}`
        : ref.heading
          ? Array.from(article.querySelectorAll<HTMLElement>("[data-ofm-heading]")).find(
              (el) => (el.getAttribute("data-ofm-heading") ?? "").toLowerCase() === ref.heading!.toLowerCase(),
            )?.id
          : undefined;
      if (targetId) {
        const el = article.querySelector<HTMLElement>(`[id="${targetId.replaceAll('"', '\\"')}"]`);
        if (el) {
          el.scrollIntoView?.({ behavior: "smooth", block: "center" });
          el.classList.add("ofm-block-flash");
          window.setTimeout(() => el.classList.remove("ofm-block-flash"), 1200);
          return;
        }
      }
      context.ui.showNotice("Target heading or block not found in this note.");
      return;
    }

    const resolved = index.resolveNoteTarget(ref.target);
    if (resolved) {
      const search = ref.blockId ? `^${ref.blockId}` : ref.heading;
      if (options.onNavigateNote) {
        await options.onNavigateNote(resolved.id, search);
      } else {
        await context.ui.openNote(resolved.id, search ? { search } : undefined);
      }
      return;
    }

    if (settings.missingNoteAction === "create") {
      const notebookId = index.getDefaultNotebookId();
      if (!notebookId) {
        context.ui.showNotice(`Cannot create note "${ref.target}" because no notebook was found.`);
        return;
      }
      const created = await context.notes.create({
        notebookId,
        title: ref.target,
        contentMarkdown: `# ${ref.target}\n\n`,
      });
      await index.refresh(true);
      context.ui.showNotice(`Created note "${created.title || ref.target}".`);
      if (options.onNavigateNote) {
        await options.onNavigateNote(created.id);
      } else {
        await context.ui.openNote(created.id);
      }
      return;
    }

    context.ui.showNotice(`Note "${ref.target}" does not exist.`);
  };

  const handleClick = async (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const wikiEl = target.closest<HTMLElement>("[data-ofm-wikilink]");
    if (wikiEl) {
      event.preventDefault();
      const raw = wikiEl.getAttribute("data-ofm-wikilink");
      if (!raw) return;
      try {
        await openOrCreateWikilink(JSON.parse(raw) as WikilinkRef);
      } catch (err) {
        context.ui.showNotice(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const openBtn = target.closest<HTMLElement>("[data-ofm-open-note]");
    if (openBtn) {
      event.preventDefault();
      const targetId = openBtn.getAttribute("data-ofm-open-note");
      const search = openBtn.getAttribute("data-ofm-open-search") || undefined;
      if (targetId) {
        if (options.onNavigateNote) await options.onNavigateNote(targetId, search);
        else await context.ui.openNote(targetId, search ? { search } : undefined);
      }
      return;
    }

    const scrollLink = target.closest<HTMLElement>("[data-ofm-scroll-id]");
    if (scrollLink) {
      event.preventDefault();
      const domId = scrollLink.getAttribute("data-ofm-scroll-id");
      if (domId) {
        const el = article.querySelector<HTMLElement>(`[id="${domId.replaceAll('"', '\\"')}"]`);
        if (el) {
          el.scrollIntoView?.({ behavior: "smooth", block: "center" });
          el.classList.add("ofm-block-flash");
          window.setTimeout(() => el.classList.remove("ofm-block-flash"), 1200);
        }
      }
      return;
    }

    const copyBlockBtn = target.closest<HTMLElement>("[data-ofm-copy-block]");
    if (copyBlockBtn) {
      event.preventDefault();
      const blockId = copyBlockBtn.getAttribute("data-ofm-copy-block");
      if (!blockId) return;
      const refText = noteTitle ? `[[${noteTitle}#^${blockId}]]` : `^${blockId}`;
      try {
        await navigator.clipboard?.writeText(refText);
      } catch {
        // Clipboard may be unavailable in restricted contexts; still notify user.
      }
      context.ui.showNotice(`Copied block reference: ${refText}`);
      return;
    }

    const copyCodeBtn = target.closest<HTMLButtonElement>("[data-ofm-copy-code]");
    if (copyCodeBtn) {
      event.preventDefault();
      const code = copyCodeBtn.getAttribute("data-ofm-copy-code") ?? "";
      try {
        await navigator.clipboard?.writeText(code);
      } catch {
        // Ignore clipboard unavailability.
      }
      copyCodeBtn.textContent = "Copied";
      window.setTimeout(() => {
        if (!disposed) copyCodeBtn.textContent = "Copy";
      }, 1500);
    }
  };

  const handleChange = async (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target || !target.classList.contains("ofm-task-checkbox")) return;
    const offsetRaw = target.getAttribute("data-ofm-task-offset");
    if (!offsetRaw) return;
    const offset = Number(offsetRaw);
    if (!Number.isSafeInteger(offset)) return;

    const checked = target.checked;
    const replacement = checked ? "[x]" : "[ ]";
    try {
      const editorDoc = await context.editor.getDocument();
      if (editorDoc && (!noteId || editorDoc.noteId === noteId)) {
        await context.editor.editMarkdown([{ from: offset, to: offset + 3, insert: replacement }]);
      } else if (noteId) {
        const note = await context.notes.get(noteId);
        await context.notes.editMarkdown(noteId, {
          expectedRevision: note.revision,
          expectedContentHash: note.contentHash,
          edits: [{ from: offset, to: offset + 3, insert: replacement }],
        });
      }
      target.closest("li")?.classList.toggle("ofm-task-item-checked", checked);
      await options.onNoteMutated?.();
    } catch (err) {
      target.checked = !checked;
      context.ui.showNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const clickListener = (event: Event) => {
    void handleClick(event);
  };
  const changeListener = (event: Event) => {
    void handleChange(event);
  };
  article.addEventListener("click", clickListener);
  article.addEventListener("change", changeListener);

  return {
    parsed,
    dispose() {
      disposed = true;
      article.removeEventListener("click", clickListener);
      article.removeEventListener("change", changeListener);
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.length = 0;
    },
  };
};
