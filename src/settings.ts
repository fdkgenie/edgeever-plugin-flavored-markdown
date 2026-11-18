import type { PluginContext } from "@edgeever/plugin-api";
import { DEFAULT_OFM_SETTINGS, type MissingNoteAction, type OfmSettings } from "./types.ts";

const readBool = async (context: PluginContext, key: string, fallback: boolean): Promise<boolean> => {
  try {
    const value = await context.settings.get(key);
    return typeof value === "boolean" ? value : fallback;
  } catch {
    return fallback;
  }
};

const readNumber = async (
  context: PluginContext,
  key: string,
  fallback: number,
  min: number,
  max: number,
): Promise<number> => {
  try {
    const value = await context.settings.get(key);
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.min(max, Math.max(min, Math.round(value)));
    }
    return fallback;
  } catch {
    return fallback;
  }
};

const readMissingAction = async (context: PluginContext): Promise<MissingNoteAction> => {
  try {
    const value = await context.settings.get("behavior.missing_note_action");
    return value === "notice" ? "notice" : "create";
  } catch {
    return DEFAULT_OFM_SETTINGS.missingNoteAction;
  }
};

export const readOfmSettings = async (context: PluginContext): Promise<OfmSettings> => {
  const [
    syntaxWikilinks,
    syntaxEmbeds,
    syntaxCallouts,
    syntaxHighlights,
    syntaxComments,
    syntaxFootnotes,
    syntaxBlockIds,
    syntaxMath,
    syntaxStrictHtml,
    readerShowComments,
    readerShowBlockIds,
    readerMaxEmbedDepth,
    editorWikilinkAutocomplete,
    editorCtrlClickOpen,
    missingNoteAction,
  ] = await Promise.all([
    readBool(context, "syntax.wikilinks", DEFAULT_OFM_SETTINGS.syntaxWikilinks),
    readBool(context, "syntax.embeds", DEFAULT_OFM_SETTINGS.syntaxEmbeds),
    readBool(context, "syntax.callouts", DEFAULT_OFM_SETTINGS.syntaxCallouts),
    readBool(context, "syntax.highlights", DEFAULT_OFM_SETTINGS.syntaxHighlights),
    readBool(context, "syntax.comments", DEFAULT_OFM_SETTINGS.syntaxComments),
    readBool(context, "syntax.footnotes", DEFAULT_OFM_SETTINGS.syntaxFootnotes),
    readBool(context, "syntax.block_ids", DEFAULT_OFM_SETTINGS.syntaxBlockIds),
    readBool(context, "syntax.math", DEFAULT_OFM_SETTINGS.syntaxMath),
    readBool(context, "syntax.strict_html", DEFAULT_OFM_SETTINGS.syntaxStrictHtml),
    readBool(context, "reader.show_comments", DEFAULT_OFM_SETTINGS.readerShowComments),
    readBool(context, "reader.show_block_ids", DEFAULT_OFM_SETTINGS.readerShowBlockIds),
    readNumber(context, "reader.max_embed_depth", DEFAULT_OFM_SETTINGS.readerMaxEmbedDepth, 1, 6),
    readBool(context, "editor.wikilink_autocomplete", DEFAULT_OFM_SETTINGS.editorWikilinkAutocomplete),
    readBool(context, "editor.ctrl_click_open", DEFAULT_OFM_SETTINGS.editorCtrlClickOpen),
    readMissingAction(context),
  ]);

  return {
    syntaxWikilinks,
    syntaxEmbeds,
    syntaxCallouts,
    syntaxHighlights,
    syntaxComments,
    syntaxFootnotes,
    syntaxBlockIds,
    syntaxMath,
    syntaxStrictHtml,
    readerShowComments,
    readerShowBlockIds,
    readerMaxEmbedDepth,
    editorWikilinkAutocomplete,
    editorCtrlClickOpen,
    missingNoteAction,
  };
};

export interface SettingsController {
  get(): OfmSettings;
  refresh(): Promise<OfmSettings>;
  subscribe(listener: (next: OfmSettings) => void): () => void;
  dispose(): void;
}

export const createSettingsController = (context: PluginContext): SettingsController => {
  let current: OfmSettings = { ...DEFAULT_OFM_SETTINGS };
  const listeners = new Set<(next: OfmSettings) => void>();

  const refresh = async (): Promise<OfmSettings> => {
    current = await readOfmSettings(context);
    for (const listener of listeners) {
      listener(current);
    }
    return current;
  };

  const disposeEvent = context.events.on("settings.changed", () => {
    void refresh();
  });

  return {
    get: () => current,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposeEvent();
      listeners.clear();
    },
  };
};
