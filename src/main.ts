import type { EdgeEverPlugin, PluginContext } from "@edgeever/plugin-api";
import { convertOfmToStandardMarkdown, convertStandardToOfmMarkdown } from "./converter.ts";
import { createEditorAssist } from "./editor-assist.ts";
import { createComposerPanel } from "./panels/composer-panel.ts";
import { createReaderPanel } from "./panels/reader-panel.ts";
import { createSettingsController } from "./settings.ts";
import { WorkspaceNoteIndex } from "./workspace-index.ts";

const wrapSelectionOrInsert = async (
  context: PluginContext,
  prefix: string,
  suffix: string,
  placeholder: string,
) => {
  const selection = await context.editor.getSelection();
  if (!selection) {
    context.ui.showNotice("Open an editable note first.");
    return;
  }
  if (!selection.empty && selection.text) {
    const inner = selection.text;
    if (inner.startsWith(prefix) && inner.endsWith(suffix) && inner.length > prefix.length + suffix.length) {
      await context.editor.replaceSelection(inner.slice(prefix.length, inner.length - suffix.length));
    } else {
      await context.editor.replaceSelection(`${prefix}${inner}${suffix}`);
    }
    return;
  }
  await context.editor.insertAtCursor(`${prefix}${placeholder}${suffix}`);
};

const generateBlockId = (): string => `b-${Math.random().toString(36).slice(2, 8)}`;

const plugin: EdgeEverPlugin = {
  async activate(context) {
    const settingsController = createSettingsController(context);
    await settingsController.refresh();
    const index = new WorkspaceNoteIndex(context);

    const disposers: Array<() => void> = [
      () => settingsController.dispose(),
      () => index.dispose(),
    ];

    disposers.push(
      context.ui.panels.register(createReaderPanel(context, index, settingsController)),
      context.ui.panels.register(createComposerPanel(context, index)),
      createEditorAssist(context, index, settingsController),
    );

    disposers.push(
      context.commands.register({
        id: "open-reader",
        title: "Open OFM Reader & Preview",
        listed: true,
        menu: true,
        async run() {
          await context.ui.panels.open("ofm-reader", { state: { tab: "reader" } });
        },
      }),
      context.commands.register({
        id: "open-composer",
        title: "Insert OFM Syntax (Builder)",
        listed: true,
        menu: true,
        async run() {
          await context.ui.panels.open("ofm-composer", { state: { mode: "link" } });
        },
      }),
      context.commands.register({
        id: "open-backlinks",
        title: "Inspect Backlinks & Block Anchors",
        listed: true,
        menu: true,
        async run() {
          await context.ui.panels.open("ofm-reader", { state: { tab: "backlinks" } });
        },
      }),
      context.commands.register({
        id: "toggle-highlight",
        title: "Toggle ==Highlight==",
        listed: false,
        menu: true,
        async run() {
          await wrapSelectionOrInsert(context, "==", "==", "highlighted text");
        },
      }),
      context.commands.register({
        id: "toggle-comment",
        title: "Toggle %%Comment%%",
        listed: false,
        menu: true,
        async run() {
          await wrapSelectionOrInsert(context, "%%", "%%", "hidden comment");
        },
      }),
      context.commands.register({
        id: "insert-callout",
        title: "Insert Callout Block",
        listed: false,
        menu: true,
        async run() {
          const selection = await context.editor.getSelection();
          if (!selection) {
            context.ui.showNotice("Open an editable note first.");
            return;
          }
          const body = selection.empty ? "Write callout details here." : selection.text.split(/\r?\n/).join("\n> ");
          const callout = `> [!note] Note\n> ${body}`;
          if (selection.empty) await context.editor.insertAtCursor(`\n${callout}\n`);
          else await context.editor.replaceSelection(callout);
        },
      }),
      context.commands.register({
        id: "insert-footnote",
        title: "Insert Footnote [^id]",
        listed: false,
        menu: true,
        async run() {
          const doc = await context.editor.getDocument();
          if (!doc) {
            context.ui.showNotice("Open an editable note first.");
            return;
          }
          let n = 1;
          while (doc.contentMarkdown.includes(`[^${n}]`)) n += 1;
          const marker = `[^${n}]`;
          await context.editor.insertAtCursor(marker);
          const updated = await context.editor.getDocument();
          if (updated && !updated.contentMarkdown.includes(`[^${n}]:`)) {
            const len = updated.contentMarkdown.length;
            await context.editor.editMarkdown([{ from: len, to: len, insert: `\n\n[^${n}]: Footnote text` }]);
          }
        },
      }),
      context.commands.register({
        id: "insert-block-id",
        title: "Append ^block-id Anchor",
        listed: false,
        menu: true,
        async run() {
          const doc = await context.editor.getDocument();
          if (!doc) {
            context.ui.showNotice("Open an editable note first.");
            return;
          }
          const id = generateBlockId();
          await context.editor.insertAtCursor(` ^${id}`);
          context.ui.showNotice(`Inserted block anchor ^${id}`);
        },
      }),
      context.commands.register({
        id: "convert-ofm-to-standard",
        title: "Convert Active Note: OFM -> EdgeEver Markdown",
        listed: false,
        menu: true,
        async run() {
          const doc = await context.editor.getDocument();
          if (!doc) {
            context.ui.showNotice("Open an editable note first.");
            return;
          }
          await index.ensureLoaded();
          const next = convertOfmToStandardMarkdown(doc.contentMarkdown, {
            resolveNote: (target) => {
              const found = index.resolveNoteTarget(target);
              return found ? { id: found.id, title: found.title } : null;
            },
          });
          if (next === doc.contentMarkdown) {
            context.ui.showNotice("No convertible OFM syntax found.");
            return;
          }
          await context.editor.editMarkdown([{ from: 0, to: doc.contentMarkdown.length, insert: next }]);
          context.ui.showNotice("Converted OFM syntax to standard EdgeEver Markdown.");
        },
      }),
      context.commands.register({
        id: "convert-standard-to-ofm",
        title: "Convert Active Note: EdgeEver Markdown -> OFM",
        listed: false,
        menu: true,
        async run() {
          const doc = await context.editor.getDocument();
          if (!doc) {
            context.ui.showNotice("Open an editable note first.");
            return;
          }
          await index.ensureLoaded();
          const next = convertStandardToOfmMarkdown(doc.contentMarkdown, (noteId) => {
            return index.getNoteById(noteId)?.title ?? null;
          });
          if (next === doc.contentMarkdown) {
            context.ui.showNotice("No convertible EdgeEver links or marks found.");
            return;
          }
          await context.editor.editMarkdown([{ from: 0, to: doc.contentMarkdown.length, insert: next }]);
          context.ui.showNotice("Converted EdgeEver Markdown to OFM syntax.");
        },
      }),
    );

    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch {
          // Ensure all disposers run during plugin deactivation.
        }
      }
    };
  },
};

export default plugin;
