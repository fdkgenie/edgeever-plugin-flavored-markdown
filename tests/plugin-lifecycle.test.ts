import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHTML } from "linkedom";
import type {
  EdgeEverPlugin,
  PluginCommand,
  PluginContext,
  PluginEventMap,
  PluginMarkdownEdit,
  PluginNote,
  PluginPanel,
  PluginPanelChrome,
  PluginPanelOpenOptions,
  PluginSettingValue,
} from "@edgeever/plugin-api";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalElement = globalThis.Element;
const originalHTMLElement = globalThis.HTMLElement;
const originalHTMLTextAreaElement = globalThis.HTMLTextAreaElement;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const { window: domWindow, document: domDocument } = parseHTML("<!doctype html><html><head></head><body></body></html>");
const objectUrlStore = new Map<string, Blob>();
let objectUrlSeq = 0;

globalThis.window = domWindow as unknown as Window & typeof globalThis;
globalThis.document = domDocument as unknown as Document;
globalThis.Element = domWindow.Element;
globalThis.HTMLElement = domWindow.HTMLElement;
globalThis.HTMLTextAreaElement = domWindow.HTMLTextAreaElement;

URL.createObjectURL = (blob: Blob) => {
  objectUrlSeq += 1;
  const url = `blob:test-${objectUrlSeq}`;
  objectUrlStore.set(url, blob);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  objectUrlStore.delete(url);
};

afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  if (originalWindow !== undefined) globalThis.window = originalWindow;
  if (originalDocument !== undefined) globalThis.document = originalDocument;
  else delete (globalThis as Record<string, unknown>).document;
  if (originalElement !== undefined) globalThis.Element = originalElement;
  else delete (globalThis as Record<string, unknown>).Element;
  if (originalHTMLElement !== undefined) globalThis.HTMLElement = originalHTMLElement;
  else delete (globalThis as Record<string, unknown>).HTMLElement;
  if (originalHTMLTextAreaElement !== undefined) globalThis.HTMLTextAreaElement = originalHTMLTextAreaElement;
  else delete (globalThis as Record<string, unknown>).HTMLTextAreaElement;
});

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

const applyEdits = (markdown: string, edits: PluginMarkdownEdit[]): string => {
  const ordered = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  return ordered.reduceRight(
    (current, edit) => `${current.slice(0, edit.from)}${edit.insert}${current.slice(edit.to)}`,
    markdown,
  );
};

const pluginRoot = resolve(import.meta.dir, "..");
const distDir = resolve(pluginRoot, "dist");
const monorepoPublicExtDir = resolve(pluginRoot, "../../apps/web/public/extensions/flavored-markdown");

let bundledPlugin: EdgeEverPlugin;

beforeAll(async () => {
  if (!existsSync(resolve(distDir, "main.js"))) {
    await import("../scripts/build.mjs");
  }
  const mod = (await import(resolve(distDir, "main.js"))) as { default: EdgeEverPlugin };
  bundledPlugin = mod.default;
});

describe("Flavored Markdown Plugin — standalone distribution & lifecycle", () => {
  beforeEach(() => {
    objectUrlStore.clear();
    domDocument.body.replaceChildren();
    domDocument.head.replaceChildren();
  });

  test("dist/ contains valid manifest.json, main.js, and styles.css aligned with source", async () => {
    const [srcManifest, distManifest, srcCss, distCss, distMain] = await Promise.all([
      readFile(resolve(pluginRoot, "manifest.json"), "utf8"),
      readFile(resolve(distDir, "manifest.json"), "utf8"),
      readFile(resolve(pluginRoot, "styles.css"), "utf8"),
      readFile(resolve(distDir, "styles.css"), "utf8"),
      readFile(resolve(distDir, "main.js"), "utf8"),
    ]);

    expect(await sha256Hex(distManifest)).toBe(await sha256Hex(srcManifest));
    expect(await sha256Hex(distCss)).toBe(await sha256Hex(srcCss));
    expect(distMain.length).toBeGreaterThan(1000);

    const parsedManifest = JSON.parse(distManifest) as { id: string; apiVersion: string; entry: string; settingsUi: string };
    expect(parsedManifest.id).toBe("com.edgeever.flavored-markdown");
    expect(parsedManifest.apiVersion).toBe("2");
    expect(parsedManifest.settingsUi).toBe("host");
    expect(parsedManifest.entry).toBe("./main.js");

    if (existsSync(monorepoPublicExtDir)) {
      const [pubManifest, pubMain, pubCss] = await Promise.all([
        readFile(resolve(monorepoPublicExtDir, "manifest.json"), "utf8"),
        readFile(resolve(monorepoPublicExtDir, "main.js"), "utf8"),
        readFile(resolve(monorepoPublicExtDir, "styles.css"), "utf8"),
      ]);
      expect(await sha256Hex(pubManifest)).toBe(await sha256Hex(distManifest));
      expect(await sha256Hex(pubMain)).toBe(await sha256Hex(distMain));
      expect(await sha256Hex(pubCss)).toBe(await sha256Hex(distCss));
    }
  });

  test("activates, executes commands, renders reader/embeds/backlinks/composer, and cleans up", async () => {
    const now = "2026-11-18T00:00:00.000Z";
    const notes = new Map<string, PluginNote>([
      ["note-1", {
        kind: "text",
        id: "note-1",
        notebookId: "nb-1",
        title: "Home Note",
        excerpt: "Home",
        tags: [],
        isPinned: false,
        createdAt: now,
        updatedAt: now,
        contentJson: { type: "doc", content: [] },
        revision: 1,
        contentMarkdown: [
          "# Home Note",
          "",
          "> [!tip]+ Tip Box",
          "> Hello ==world== %%secret%%",
          "",
          "- [ ] Pending task",
          "",
          "See [[Target Note|Target]] and ![[Target Note#^target-block]] and ![[diagram.png|220]].",
        ].join("\n"),
        contentText: "Home Note",
        contentHash: "hash-1",
      }],
      ["note-2", {
        kind: "text",
        id: "note-2",
        notebookId: "nb-1",
        title: "Target Note",
        excerpt: "Target",
        tags: [],
        isPinned: false,
        createdAt: now,
        updatedAt: now,
        contentJson: { type: "doc", content: [] },
        revision: 1,
        contentMarkdown: "Transcluded block content. ^target-block\n\nLinks back to [[Home Note]] and mentions Home Note.",
        contentText: "Target Note",
        contentHash: "hash-2",
      }],
      ["note-3", {
        kind: "text",
        id: "note-3",
        notebookId: "nb-1",
        title: "Unlinked Mention Note",
        excerpt: "Mention",
        tags: [],
        isPinned: false,
        createdAt: now,
        updatedAt: now,
        contentJson: { type: "doc", content: [] },
        revision: 1,
        contentMarkdown: "This note mentions Home Note without brackets.",
        contentText: "Unlinked Mention Note",
        contentHash: "hash-3",
      }],
    ]);

    const commands = new Map<string, PluginCommand>();
    const panels = new Map<string, PluginPanel>();
    const eventListeners = new Map<keyof PluginEventMap, Set<(payload: never) => void>>();
    const settingsStore = new Map<string, PluginSettingValue>();
    const storageStore = new Map<string, unknown>();
    const notices: string[] = [];
    const navigations: Array<{ noteId: string; search?: string }> = [];
    const openedPanels: Array<{ panelId: string; options?: PluginPanelOpenOptions }> = [];

    let liveMarkdown = notes.get("note-1")!.contentMarkdown;
    let selectionText = "";
    let createdCount = 0;

    const emitEvent = <K extends keyof PluginEventMap>(event: K, payload: PluginEventMap[K]) => {
      for (const listener of eventListeners.get(event) ?? []) {
        listener(payload as never);
      }
    };

    const context: PluginContext = {
      pluginId: "com.edgeever.flavored-markdown",
      ai: {
        status: async () => ({ configured: false }),
        generate: async () => ({ text: "" }),
        transcribeResource: async () => ({ text: "", resourceId: "", filename: "" }),
        transcribeMedia: async () => ({ text: "" }),
      },
      notes: {
        query: async () => ({ notes: [...notes.values()], totalCount: notes.size, nextOffset: null }),
        queryContent: async () => ({ notes: [...notes.values()], totalCount: notes.size, nextOffset: null }),
        get: async (id) => {
          const found = notes.get(id);
          if (!found) throw new Error(`Missing note ${id}`);
          return found;
        },
        editMarkdown: async (id, input) => {
          const current = notes.get(id);
          if (!current) throw new Error(`Missing note ${id}`);
          const nextMarkdown = applyEdits(current.contentMarkdown, input.edits);
          const updated: PluginNote = {
            ...current,
            revision: current.revision + 1,
            contentMarkdown: nextMarkdown,
            contentText: nextMarkdown,
            contentHash: `hash-${current.revision + 1}`,
          };
          notes.set(id, updated);
          emitEvent("note.updated", { note: updated });
          return updated;
        },
        create: async (input) => {
          createdCount += 1;
          const id = `note-created-${createdCount}`;
          const created: PluginNote = {
            kind: "text",
            id,
            notebookId: input.notebookId,
            title: input.title ?? "Untitled",
            excerpt: "",
            tags: input.tags ?? [],
            isPinned: false,
            createdAt: now,
            updatedAt: now,
            contentJson: { type: "doc", content: [] },
            revision: 1,
            contentMarkdown: input.contentMarkdown ?? "",
            contentText: input.contentMarkdown ?? "",
            contentHash: `hash-${id}`,
          };
          notes.set(id, created);
          emitEvent("note.created", { note: created });
          return created;
        },
        update: async (id, input) => {
          const current = notes.get(id)!;
          const updated = { ...current, ...input, revision: current.revision + 1 };
          notes.set(id, updated);
          return updated;
        },
        delete: async (id) => {
          notes.delete(id);
          emitEvent("note.deleted", { noteId: id });
        },
        move: async () => 1,
        pin: async () => 1,
        restore: async (id) => notes.get(id)!,
        revisions: {
          list: async () => [],
          restore: async (id) => notes.get(id)!,
        },
      },
      notebooks: {
        list: async () => [{ id: "nb-1", parentId: null, name: "Knowledge", memoCount: notes.size }],
        create: async (input) => ({ id: "nb-new", parentId: input.parentId ?? null, name: input.name, memoCount: 0 }),
        update: async (id, input) => ({ id, parentId: input.parentId ?? null, name: input.name ?? "Knowledge", memoCount: 0 }),
        delete: async () => undefined,
      },
      tags: {
        list: async () => [],
        rename: async () => 0,
        delete: async () => 0,
      },
      templates: {
        list: async () => [],
        create: async () => { throw new Error("unused"); },
        update: async () => { throw new Error("unused"); },
        delete: async () => undefined,
        use: async () => { throw new Error("unused"); },
      },
      commands: {
        register: (command) => {
          commands.set(command.id, command);
          return () => {
            commands.delete(command.id);
          };
        },
      },
      schedules: {
        upsert: async () => { throw new Error("unused"); },
        list: async () => [],
        remove: async () => undefined,
      },
      events: {
        on: (event, listener) => {
          const bucket = eventListeners.get(event) ?? new Set();
          bucket.add(listener as (payload: never) => void);
          eventListeners.set(event, bucket);
          return () => {
            bucket.delete(listener as (payload: never) => void);
          };
        },
      },
      storage: {
        get: async <T>(key: string) => (storageStore.get(key) as T | undefined) ?? null,
        set: async <T>(key: string, value: T) => { storageStore.set(key, value); },
        remove: async (key: string) => { storageStore.delete(key); },
      },
      secrets: {
        get: async () => null,
        set: async () => undefined,
        remove: async () => undefined,
      },
      editor: {
        getSelection: async () => ({
          noteId: "note-1",
          from: 0,
          to: selectionText.length,
          empty: selectionText.length === 0,
          text: selectionText,
          contentMarkdown: liveMarkdown,
        }),
        getDocument: async () => ({
          noteId: "note-1",
          contentMarkdown: liveMarkdown,
          hasUnsavedChanges: false,
        }),
        editMarkdown: async (edits) => {
          liveMarkdown = applyEdits(liveMarkdown, edits);
          return { noteId: "note-1", contentMarkdown: liveMarkdown, hasUnsavedChanges: true };
        },
        insertEmbed: async () => { throw new Error("unused"); },
        embeds: { register: () => () => undefined },
        replaceSelection: async (next) => {
          selectionText = next;
        },
        insertAtCursor: async (snippet) => {
          liveMarkdown += snippet;
        },
      },
      resources: {
        list: async () => [{
          id: "res-img-1",
          noteId: "note-1",
          kind: "image",
          mimeType: "image/png",
          filename: "diagram.png",
          byteSize: 9,
          contentHash: "img-hash",
          width: 220,
          height: 120,
          createdAt: now,
          updatedAt: now,
          url: "/api/v1/resources/res-img-1/blob",
        }],
        read: async () => new Blob(["png-bytes"], { type: "image/png" }),
        upload: async () => { throw new Error("unused"); },
        update: async () => { throw new Error("unused"); },
        rename: async () => { throw new Error("unused"); },
        delete: async () => undefined,
      },
      settings: {
        get: async (key) => settingsStore.get(key) ?? null,
        set: async (key, value) => {
          settingsStore.set(key, value);
          emitEvent("settings.changed", { key });
        },
        remove: async (key) => {
          settingsStore.delete(key);
          emitEvent("settings.changed", { key });
        },
      },
      network: {
        fetch: async () => new Response(null, { status: 404 }),
      },
      ui: {
        showNotice: (message) => { notices.push(message); },
        openNote: async (noteId, options) => { navigations.push({ noteId, search: options?.search }); },
        panels: {
          register: (panel) => {
            panels.set(panel.id, panel);
            return () => {
              panels.delete(panel.id);
            };
          },
          open: async (panelId, options) => {
            openedPanels.push({ panelId, options });
          },
        },
      },
    };

    const deactivate = await bundledPlugin.activate(context);
    expect([...panels.keys()]).toEqual(["ofm-reader", "ofm-composer"]);
    expect([...commands.keys()]).toEqual([
      "open-reader",
      "open-composer",
      "open-backlinks",
      "toggle-highlight",
      "toggle-comment",
      "insert-callout",
      "insert-footnote",
      "insert-block-id",
      "convert-ofm-to-standard",
      "convert-standard-to-ofm",
    ]);

    // Test commands
    await commands.get("open-reader")!.run();
    await commands.get("open-composer")!.run();
    await commands.get("open-backlinks")!.run();
    expect(openedPanels.map((p) => p.panelId)).toEqual(["ofm-reader", "ofm-composer", "ofm-reader"]);

    selectionText = "focus";
    await commands.get("toggle-highlight")!.run();
    expect(selectionText).toBe("==focus==");

    selectionText = "hidden note";
    await commands.get("toggle-comment")!.run();
    expect(selectionText).toBe("%%hidden note%%");

    selectionText = "inside callout";
    await commands.get("insert-callout")!.run();
    expect(selectionText).toBe("> [!note] Note\n> inside callout");

    selectionText = "";
    await commands.get("insert-footnote")!.run();
    expect(liveMarkdown).toContain("[^1]");
    expect(liveMarkdown).toContain("[^1]: Footnote text");

    await commands.get("insert-block-id")!.run();
    expect(liveMarkdown).toMatch(/\^b-[a-z0-9]+$/);

    // Test OFM <-> Standard converters
    const savedBeforeConvert = liveMarkdown;
    liveMarkdown = "Read [[Target Note|Target]] with ==mark== and %%note%%.";
    await commands.get("convert-ofm-to-standard")!.run();
    expect(liveMarkdown).toBe("Read [Target](#memo=note-2) with <mark>mark</mark> and .");
    await commands.get("convert-standard-to-ofm")!.run();
    expect(liveMarkdown).toBe("Read [[Target Note|Target]] with ==mark== and .");
    liveMarkdown = savedBeforeConvert;

    // Mount OFM Reader panel
    const readerContainer = domDocument.createElement("div");
    let latestChrome: PluginPanelChrome = {};
    const readerPanel = panels.get("ofm-reader")!;
    const disposeReader = await readerPanel.mount(readerContainer as unknown as HTMLElement, {
      state: { tab: "reader" },
      requestClose: async () => undefined,
      shell: {
        set: (chrome) => {
          latestChrome = chrome;
        },
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(readerContainer.innerHTML).toContain('data-callout="tip"');
    expect(readerContainer.innerHTML).toContain('<mark class="ofm-highlight">world</mark>');
    expect(readerContainer.innerHTML).not.toContain("secret");
    expect(readerContainer.innerHTML).toContain("Transcluded block content.");
    expect(readerContainer.innerHTML).toContain('src="blob:test-');
    expect(objectUrlStore.size).toBe(1);

    // Task toggle inside Reader
    const checkbox = readerContainer.querySelector<HTMLInputElement>(".ofm-task-checkbox");
    expect(checkbox).toBeTruthy();
    checkbox!.checked = true;
    checkbox!.dispatchEvent(new domWindow.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(liveMarkdown).toContain("- [x] Pending task");

    // Backlinks tab
    latestChrome.onChange?.("tab", "backlinks");
    await new Promise((r) => setTimeout(r, 20));
    expect(readerContainer.innerHTML).toContain("Target Note");
    expect(readerContainer.innerHTML).toContain("Unlinked Mention Note");

    // Wikilink click navigation
    latestChrome.onChange?.("tab", "reader");
    await new Promise((r) => setTimeout(r, 20));
    const targetLink = readerContainer.querySelector<HTMLAnchorElement>(".ofm-wikilink");
    expect(targetLink).toBeTruthy();
    targetLink!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(navigations.some((n) => n.noteId === "note-2")).toBe(true);

    // Circular embed guard + missing note creation
    notes.get("note-1")!.contentMarkdown = "Self loop: ![[Home Note]]\n\nMissing: [[Brand New Note]]";
    liveMarkdown = notes.get("note-1")!.contentMarkdown;
    const loopContainer = domDocument.createElement("div");
    const disposeLoopReader = await readerPanel.mount(loopContainer as unknown as HTMLElement, {
      state: { tab: "reader", noteId: "note-1" },
      requestClose: async () => undefined,
      shell: { set: () => undefined },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(loopContainer.innerHTML).toContain("Circular embed detected");
    const unresolvedLink = loopContainer.querySelector<HTMLAnchorElement>(".ofm-wikilink-unresolved");
    expect(unresolvedLink).toBeTruthy();
    unresolvedLink!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(createdCount).toBe(1);
    expect([...notes.values()].some((n) => n.title === "Brand New Note")).toBe(true);
    if (typeof disposeLoopReader === "function") disposeLoopReader();

    // Composer panel
    const composerContainer = domDocument.createElement("div");
    let closeRequested = false;
    const disposeComposer = await panels.get("ofm-composer")!.mount(composerContainer as unknown as HTMLElement, {
      state: { mode: "link" },
      requestClose: async () => {
        closeRequested = true;
      },
      shell: { set: () => undefined },
    });
    const insertBtn = composerContainer.querySelector<HTMLButtonElement>("[data-ofm-insert]");
    expect(insertBtn).toBeTruthy();
    insertBtn!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(liveMarkdown).toContain("[[");
    expect(closeRequested).toBe(true);

    // Cleanup checks
    if (typeof disposeReader === "function") disposeReader();
    if (typeof disposeComposer === "function") disposeComposer();
    expect(objectUrlStore.size).toBe(0);

    if (typeof deactivate === "function") await deactivate();
    expect(panels.size).toBe(0);
    expect(commands.size).toBe(0);
    expect(notices.length).toBeGreaterThan(0);
  });
});
