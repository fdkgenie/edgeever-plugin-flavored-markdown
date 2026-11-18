export type MissingNoteAction = "create" | "notice";

export interface OfmSettings {
  syntaxWikilinks: boolean;
  syntaxEmbeds: boolean;
  syntaxCallouts: boolean;
  syntaxHighlights: boolean;
  syntaxComments: boolean;
  syntaxFootnotes: boolean;
  syntaxBlockIds: boolean;
  syntaxMath: boolean;
  syntaxStrictHtml: boolean;
  readerShowComments: boolean;
  readerShowBlockIds: boolean;
  readerMaxEmbedDepth: number;
  editorWikilinkAutocomplete: boolean;
  editorCtrlClickOpen: boolean;
  missingNoteAction: MissingNoteAction;
}

export const DEFAULT_OFM_SETTINGS: OfmSettings = {
  syntaxWikilinks: true,
  syntaxEmbeds: true,
  syntaxCallouts: true,
  syntaxHighlights: true,
  syntaxComments: true,
  syntaxFootnotes: true,
  syntaxBlockIds: true,
  syntaxMath: true,
  syntaxStrictHtml: true,
  readerShowComments: false,
  readerShowBlockIds: true,
  readerMaxEmbedDepth: 3,
  editorWikilinkAutocomplete: true,
  editorCtrlClickOpen: true,
  missingNoteAction: "create",
};

export interface WikilinkRef {
  raw: string;
  isEmbed: boolean;
  target: string;
  heading?: string;
  blockId?: string;
  alias?: string;
  width?: number;
  height?: number;
}

export interface HeadingEntry {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface BlockEntry {
  id: string;
  markdown: string;
  line: number;
}

export interface TaskMarker {
  checked: boolean;
  /** UTF-16 character offset of `[` inside the `[ ]` / `[x]` marker within the source note. */
  offset: number;
  line: number;
  text: string;
}

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface ParsedOfmDocument {
  frontmatter: FrontmatterEntry[];
  body: string;
  bodyOffset: number;
  headings: HeadingEntry[];
  blocks: Record<string, BlockEntry>;
  links: WikilinkRef[];
  tasks: TaskMarker[];
  html: string;
}
