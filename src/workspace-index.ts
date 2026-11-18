import type { PluginContext, PluginNotebook, PluginNote } from "@edgeever/plugin-api";
import { parseOfmDocument } from "./ofm-parser.ts";
import type { BlockEntry, HeadingEntry, WikilinkRef } from "./types.ts";

export interface IndexedNote {
  id: string;
  notebookId: string;
  title: string;
  contentMarkdown: string;
  updatedAt: string;
  headings: HeadingEntry[];
  blocks: Record<string, BlockEntry>;
  links: WikilinkRef[];
}

export interface BacklinkItem {
  noteId: string;
  noteTitle: string;
  snippet: string;
  line: number;
}

export interface BacklinksResult {
  linked: BacklinkItem[];
  unlinked: BacklinkItem[];
}

export interface AutocompleteSuggestion {
  kind: "note" | "heading" | "block";
  label: string;
  detail: string;
  insertText: string;
  noteId: string;
}

const stripMarkdownExtension = (value: string) => value.replace(/\.md$/i, "").trim();

const indexSingleNote = (
  id: string,
  notebookId: string,
  title: string | null,
  contentMarkdown: string,
  updatedAt: string,
): IndexedNote => {
  const parsed = parseOfmDocument(contentMarkdown);
  return {
    id,
    notebookId,
    title: (title ?? "").trim() || "Untitled",
    contentMarkdown,
    updatedAt,
    headings: parsed.headings,
    blocks: parsed.blocks,
    links: parsed.links,
  };
};

const findSnippetLine = (markdown: string, needle: string): { line: number; snippet: string } => {
  const lines = markdown.split(/\r?\n/);
  const lowerNeedle = needle.toLowerCase();
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.toLowerCase().includes(lowerNeedle)) {
      return { line: i + 1, snippet: lines[i]!.trim().slice(0, 160) };
    }
  }
  return { line: 1, snippet: lines[0]?.trim().slice(0, 160) ?? "" };
};

export class WorkspaceNoteIndex {
  private readonly context: PluginContext;
  private readonly notes = new Map<string, IndexedNote>();
  private readonly notebooks = new Map<string, PluginNotebook>();
  private readonly listeners = new Set<() => void>();
  private readonly disposers: Array<() => void> = [];
  private loadingPromise: Promise<void> | null = null;
  private initialized = false;

  constructor(context: PluginContext) {
    this.context = context;
    this.disposers.push(
      context.events.on("note.created", ({ note }) => this.handleNoteEvent(note)),
      context.events.on("note.updated", ({ note }) => this.handleNoteEvent(note)),
      context.events.on("note.deleted", ({ noteId }) => {
        if (this.notes.delete(noteId)) this.notify();
      }),
      context.events.on("workspace.synced", ({ changed }) => {
        if (changed > 0) void this.refresh(true);
      }),
    );
  }

  private handleNoteEvent(note: PluginNote) {
    if (note.kind !== "text") {
      if (this.notes.delete(note.id)) this.notify();
      return;
    }
    this.notes.set(
      note.id,
      indexSingleNote(note.id, note.notebookId, note.title, note.contentMarkdown, note.updatedAt),
    );
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.initialized) return;
    await this.refresh(false);
  }

  async refresh(force = true): Promise<void> {
    if (this.loadingPromise && !force) return this.loadingPromise;
    const run = async () => {
      const nextNotes = new Map<string, IndexedNote>();
      let offset = 0;
      while (true) {
        const page = await this.context.notes.queryContent({
          sort: "updated-desc",
          limit: 200,
          offset,
        });
        for (const note of page.notes) {
          if (note.kind !== "text") continue;
          nextNotes.set(
            note.id,
            indexSingleNote(note.id, note.notebookId, note.title, note.contentMarkdown, note.updatedAt),
          );
        }
        if (page.nextOffset === null || page.notes.length === 0) break;
        offset = page.nextOffset;
      }

      const notebooksList = await this.context.notebooks.list().catch(() => []);
      this.notebooks.clear();
      for (const nb of notebooksList) {
        this.notebooks.set(nb.id, nb);
      }

      this.notes.clear();
      for (const [id, entry] of nextNotes) {
        this.notes.set(id, entry);
      }
      this.initialized = true;
      this.notify();
    };

    const pending = run().finally(() => {
      if (this.loadingPromise === pending) this.loadingPromise = null;
    });
    this.loadingPromise = pending;
    return pending;
  }

  upsertLiveDocument(noteId: string, contentMarkdown: string, fallbackTitle?: string) {
    const existing = this.notes.get(noteId);
    const title = existing?.title ?? fallbackTitle ?? "Untitled";
    const notebookId = existing?.notebookId ?? "";
    this.notes.set(
      noteId,
      indexSingleNote(noteId, notebookId, title, contentMarkdown, new Date().toISOString()),
    );
  }

  listNotes(): IndexedNote[] {
    return [...this.notes.values()];
  }

  getNoteById(noteId: string): IndexedNote | null {
    return this.notes.get(noteId) ?? null;
  }

  getDefaultNotebookId(): string | null {
    const firstNb = this.notebooks.values().next().value;
    if (firstNb) return firstNb.id;
    const firstNote = this.notes.values().next().value;
    return firstNote?.notebookId ?? null;
  }

  resolveNoteTarget(rawTarget: string): IndexedNote | null {
    const cleaned = stripMarkdownExtension(rawTarget);
    if (!cleaned) return null;

    const byId = this.notes.get(cleaned);
    if (byId) return byId;

    const lowered = cleaned.toLowerCase();
    if (cleaned.includes("/")) {
      const parts = cleaned.split("/");
      const noteName = parts[parts.length - 1]!.trim().toLowerCase();
      const folderName = parts[parts.length - 2]!.trim().toLowerCase();
      const notebookMatch = [...this.notes.values()].find((note) => {
        if (note.title.toLowerCase() !== noteName) return false;
        const nb = this.notebooks.get(note.notebookId);
        return nb?.name.toLowerCase() === folderName;
      });
      if (notebookMatch) return notebookMatch;
      const byBasename = [...this.notes.values()].find((note) => note.title.toLowerCase() === noteName);
      if (byBasename) return byBasename;
    }

    let best: IndexedNote | null = null;
    for (const note of this.notes.values()) {
      if (note.title.toLowerCase() === lowered) {
        if (!best || note.updatedAt > best.updatedAt) {
          best = note;
        }
      }
    }
    return best;
  }

  getBacklinks(noteId: string, noteTitle: string): BacklinksResult {
    const linked: BacklinkItem[] = [];
    const unlinked: BacklinkItem[] = [];
    const normalizedTitle = noteTitle.trim().toLowerCase();
    const memoHrefNeedle = `#memo=${noteId}`.toLowerCase();
    const escapedTitle = noteTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionRegex = escapedTitle.length >= 2
      ? new RegExp(`(?<![\\p{L}\\p{N}_])${escapedTitle}(?![\\p{L}\\p{N}_])`, "iu")
      : null;

    for (const note of this.notes.values()) {
      if (note.id === noteId) continue;
      const matchingRef = note.links.find((link) => {
        if (!link.target) return false;
        const resolved = this.resolveNoteTarget(link.target);
        if (resolved) return resolved.id === noteId;
        return stripMarkdownExtension(link.target).toLowerCase() === normalizedTitle;
      });

      if (matchingRef) {
        const hit = findSnippetLine(note.contentMarkdown, matchingRef.raw);
        linked.push({
          noteId: note.id,
          noteTitle: note.title,
          snippet: hit.snippet,
          line: hit.line,
        });
        continue;
      }

      if (note.contentMarkdown.toLowerCase().includes(memoHrefNeedle)) {
        const hit = findSnippetLine(note.contentMarkdown, memoHrefNeedle);
        linked.push({
          noteId: note.id,
          noteTitle: note.title,
          snippet: hit.snippet,
          line: hit.line,
        });
        continue;
      }

      if (mentionRegex) {
        const lines = note.contentMarkdown.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          if (mentionRegex.test(line)) {
            unlinked.push({
              noteId: note.id,
              noteTitle: note.title,
              snippet: line.trim().slice(0, 160),
              line: i + 1,
            });
            break;
          }
        }
      }
    }

    return { linked, unlinked };
  }

  getNoteStructure(noteId: string) {
    const note = this.notes.get(noteId);
    if (!note) {
      return {
        headings: [] as HeadingEntry[],
        blocks: [] as BlockEntry[],
        outgoing: [] as Array<{ ref: WikilinkRef; resolved: IndexedNote | null }>,
      };
    }
    return {
      headings: note.headings,
      blocks: Object.values(note.blocks),
      outgoing: note.links.map((ref) => ({
        ref,
        resolved: ref.target ? this.resolveNoteTarget(ref.target) : note,
      })),
    };
  }

  searchSuggestions(rawQuery: string, currentNoteId?: string | null): AutocompleteSuggestion[] {
    const hashIdx = rawQuery.indexOf("#");
    if (hashIdx !== -1) {
      const targetPart = rawQuery.slice(0, hashIdx).trim();
      const fragPart = rawQuery.slice(hashIdx + 1);
      const targetNote = targetPart
        ? this.resolveNoteTarget(targetPart)
        : (currentNoteId ? this.notes.get(currentNoteId) ?? null : null);
      if (!targetNote) return [];

      const prefixTarget = targetPart ? targetNote.title : "";
      if (fragPart.startsWith("^")) {
        const blockQuery = fragPart.slice(1).toLowerCase();
        return Object.values(targetNote.blocks)
          .filter((block) => !blockQuery || block.id.toLowerCase().includes(blockQuery))
          .slice(0, 12)
          .map((block) => ({
            kind: "block" as const,
            label: `${prefixTarget}#^${block.id}`,
            detail: block.markdown.slice(0, 60) || "Block",
            insertText: `${prefixTarget}#^${block.id}`,
            noteId: targetNote.id,
          }));
      }

      const headingQuery = fragPart.toLowerCase();
      return targetNote.headings
        .filter((heading) => !headingQuery || heading.text.toLowerCase().includes(headingQuery))
        .slice(0, 12)
        .map((heading) => ({
          kind: "heading" as const,
          label: `${prefixTarget}#${heading.text}`,
          detail: `H${heading.level}`,
          insertText: `${prefixTarget}#${heading.text}`,
          noteId: targetNote.id,
        }));
    }

    const q = rawQuery.trim().toLowerCase();
    return [...this.notes.values()]
      .filter((note) => note.id !== currentNoteId && (!q || note.title.toLowerCase().includes(q)))
      .sort((a, b) => {
        const aPrefix = q && a.title.toLowerCase().startsWith(q) ? 0 : 1;
        const bPrefix = q && b.title.toLowerCase().startsWith(q) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 12)
      .map((note) => ({
        kind: "note" as const,
        label: note.title,
        detail: this.notebooks.get(note.notebookId)?.name ?? "Note",
        insertText: note.title,
        noteId: note.id,
      }));
  }

  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.listeners.clear();
    this.notes.clear();
    this.notebooks.clear();
  }
}
