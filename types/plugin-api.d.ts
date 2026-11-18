declare module "@edgeever/plugin-api" {
  export const PLUGIN_API_VERSION = "2";
  export const THEME_API_VERSION = "1";

  export type PluginPermission =
    | "notes:read"
    | "notes:write"
    | "notes:delete"
    | "metadata:read"
    | "metadata:write"
    | "resources:read"
    | "resources:write"
    | "templates:read"
    | "templates:write"
    | "network"
    | "network:public"
    | "ai:generate"
    | "storage"
    | "secrets"
    | "schedules"
    | "editor:read"
    | "editor:write"
    | "ui:commands"
    | "ui:navigation"
    | "ui:notices"
    | "ui:panels"
    | "ui:embeds";

  export type ExtensionPlatform = "web" | "desktop" | "android" | "ios";

  export interface LocalizedExtensionMetadata {
    name?: string;
    description?: string;
  }

  export type ExtensionLocales = Record<string, LocalizedExtensionMetadata>;

  export type PluginSettingValue = string | number | boolean;

  export interface PluginSettingListItem {
    title: string;
    description?: string;
  }

  export interface PluginSettingList {
    title?: string;
    actionLabel?: string;
    items: PluginSettingListItem[];
  }

  interface PluginSettingBase {
    key: string;
    label: string;
    description?: string;
    locales?: Record<string, { label?: string; description?: string; placeholder?: string; options?: Record<string, string> }>;
    required?: boolean;
    list?: PluginSettingList;
  }

  export type PluginSettingField =
    | (PluginSettingBase & { type: "text"; default?: string; placeholder?: string })
    | (PluginSettingBase & { type: "secret"; placeholder?: string })
    | (PluginSettingBase & { type: "number"; default?: number; min?: number; max?: number; step?: number })
    | (PluginSettingBase & { type: "boolean"; default?: boolean })
    | (PluginSettingBase & { type: "select"; default?: string; options: Array<{ value: string; label: string }> });

  export interface PluginSettingsSchema {
    fields: PluginSettingField[];
  }

  export interface PluginManifest {
    type: "plugin";
    id: string;
    name: string;
    version: string;
    apiVersion: "2";
    settingsUi: "host";
    description?: string;
    locales?: ExtensionLocales;
    author?: string;
    entry: string;
    platforms?: ExtensionPlatform[];
    permissions: PluginPermission[];
    networkHosts?: string[];
    settings?: PluginSettingsSchema;
  }

  export type PluginNoteKind =
    | "text"
    | "mind-map"
    | "flowchart"
    | "architecture"
    | "table"
    | "poster"
    | "infographic"
    | "video";

  export interface PluginContentNode {
    type: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    content?: PluginContentNode[];
  }

  export interface PluginContentDocument {
    type: "doc";
    content: PluginContentNode[];
  }

  export interface PluginNoteSummary {
    kind: PluginNoteKind;
    id: string;
    notebookId: string;
    title: string | null;
    excerpt: string;
    tags: string[];
    isPinned: boolean;
    createdAt: string;
    updatedAt: string;
  }

  export interface PluginNote extends PluginNoteSummary {
    contentJson: PluginContentDocument;
    revision: number;
    contentMarkdown: string;
    contentText: string;
    contentHash: string;
  }

  export interface PluginMarkdownEdit {
    from: number;
    to: number;
    insert: string;
  }

  export interface PluginMarkdownEditInput {
    expectedRevision: number;
    expectedContentHash: string;
    edits: PluginMarkdownEdit[];
  }

  export interface PluginNoteQuery {
    notebookId?: string;
    text?: string;
    tags?: string[];
    sort?: "updated-desc" | "created-desc" | "title-asc" | "title-desc";
    limit?: number;
    offset?: number;
  }

  export interface PluginNoteCreateInput {
    notebookId: string;
    title?: string;
    contentMarkdown?: string;
    tags?: string[];
  }

  export interface PluginNoteUpdateInput {
    title?: string;
    contentMarkdown?: string;
    tags?: string[];
  }

  export interface PluginNoteQueryResult {
    notes: PluginNoteSummary[];
    totalCount: number;
    nextOffset: number | null;
  }

  export interface PluginNoteContentQueryResult {
    notes: PluginNote[];
    totalCount: number;
    nextOffset: number | null;
  }

  export interface PluginNotebook {
    id: string;
    parentId: string | null;
    name: string;
    memoCount: number;
  }

  export interface PluginNoteRevision {
    id: string;
    noteId: string;
    revision: number;
    title: string | null;
    tags: string[];
    contentMarkdown: string;
    contentText: string;
    createdAt: string;
  }

  export interface PluginResource {
    id: string;
    noteId: string;
    kind: "image" | "attachment";
    mimeType: string | null;
    filename: string | null;
    byteSize: number;
    contentHash: string | null;
    width: number | null;
    height: number | null;
    createdAt: string;
    updatedAt: string;
    url: string;
  }

  export interface PluginTag {
    name: string;
    noteCount: number;
  }

  export interface PluginTemplate {
    id: string;
    name: string;
    description: string | null;
    title: string | null;
    contentMarkdown: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }

  export type PluginEventMap = {
    "settings.changed": { key: string };
    "note.created": { note: PluginNote };
    "note.updated": { note: PluginNote };
    "note.deleted": { noteId: string };
    "tag.changed": { previousName?: string; name?: string; deleted?: boolean };
    "template.created": { template: PluginTemplate };
    "template.updated": { template: PluginTemplate };
    "template.deleted": { templateId: string };
    "resource.created": { resource: PluginResource };
    "resource.updated": { resource: PluginResource };
    "resource.deleted": { resourceId: string };
    "workspace.sync-queue-changed": Record<string, never>;
    "workspace.synced": { bootstrapped: boolean; changed: number };
  };

  export interface PluginCommand {
    id: string;
    title: string;
    listed?: boolean;
    menu?: boolean;
    run: () => void | Promise<void>;
  }

  export type PluginScheduleMissedRunPolicy = "run-once" | "skip";

  export interface PluginScheduleInput {
    key: string;
    name: string;
    commandId: string;
    cronExpression: string;
    timezone?: string;
    missedRunPolicy?: PluginScheduleMissedRunPolicy;
    isEnabled?: boolean;
  }

  export interface PluginSchedule extends Required<Omit<PluginScheduleInput, "timezone" | "missedRunPolicy" | "isEnabled">> {
    timezone: string;
    missedRunPolicy: PluginScheduleMissedRunPolicy;
    isEnabled: boolean;
    runsOnThisDevice: boolean;
    lastRun: {
      status: "running" | "succeeded" | "failed";
      scheduledFor: string;
      startedAt: string;
      finishedAt: string | null;
      errorMessage: string | null;
    } | null;
  }

  export interface PluginEditorSelection {
    noteId: string;
    from: number;
    to: number;
    empty: boolean;
    text: string;
    contentMarkdown: string;
  }

  export interface PluginEditorDocument {
    noteId: string;
    contentMarkdown: string;
    hasUnsavedChanges: boolean;
  }

  export interface PluginOpenNoteOptions {
    search?: string;
  }

  export type PluginJsonValue =
    | null
    | boolean
    | number
    | string
    | PluginJsonValue[]
    | { [key: string]: PluginJsonValue };

  export type PluginPanelPresentation = "dialog" | "fullscreen";
  export type PluginPanelPurpose = "workflow" | "dashboard" | "preview" | "onboarding";

  export interface PluginPanelOpenOptions {
    state?: PluginJsonValue;
  }

  export type PluginPanelActionVariant = "default" | "primary" | "ghost";

  export interface PluginPanelAction {
    id: string;
    label: string;
    variant?: PluginPanelActionVariant;
    disabled?: boolean;
  }

  export interface PluginPanelSelectOption {
    value: string;
    label: string;
  }

  export type PluginPanelToolbarItem =
    | { type: "search"; key: string; placeholder?: string; value?: string }
    | { type: "tabs"; key: string; value?: string; options: PluginPanelSelectOption[] }
    | { type: "select"; key: string; label?: string; value?: string; options: PluginPanelSelectOption[] }
    | { type: "button"; key: string; label: string; variant?: PluginPanelActionVariant; disabled?: boolean };

  export interface PluginPanelEmptyState {
    title: string;
    description?: string;
    action?: PluginPanelAction;
  }

  export interface PluginPanelChrome {
    header?: {
      title?: string;
      description?: string | null;
      actions?: PluginPanelAction[];
    };
    toolbar?: PluginPanelToolbarItem[];
    empty?: PluginPanelEmptyState | null;
    onAction?: (id: string) => void;
    onChange?: (key: string, value: string) => void;
  }

  export interface PluginPanelShell {
    set(chrome: PluginPanelChrome): void;
  }

  export interface PluginPanelMountContext {
    state: PluginJsonValue | null;
    requestClose(): Promise<void>;
    shell: PluginPanelShell;
  }

  export type PluginPanelCloseDecision =
    | boolean
    | {
        title: string;
        message: string;
        confirmLabel?: string;
      };

  export interface PluginEmbedInput {
    type: string;
    resourceId: string;
    previewResourceId?: string;
    title?: string;
    data?: PluginJsonValue;
  }

  export interface PluginEmbedInstance extends PluginEmbedInput {
    id: string;
    pluginId: string;
    previewResourceId: string;
    title: string;
    data: PluginJsonValue;
  }

  export interface PluginEmbedRenderer {
    type: string;
    mount(container: HTMLElement, embed: PluginEmbedInstance): void | (() => void) | Promise<void | (() => void)>;
  }

  export interface PluginPanel {
    id: string;
    title: string;
    purpose: PluginPanelPurpose;
    presentation?: PluginPanelPresentation;
    mount(container: HTMLElement, context: PluginPanelMountContext): void | (() => void) | Promise<void | (() => void)>;
    beforeClose?(): PluginPanelCloseDecision | Promise<PluginPanelCloseDecision>;
  }

  export interface PluginContext {
    pluginId: string;
    ai: {
      status(): Promise<{ configured: boolean; modelName?: string }>;
      generate(input: { system: string; prompt: string; maxOutputTokens?: number; signal?: AbortSignal }): Promise<{ text: string }>;
      transcribeResource(noteId: string, resourceId: string): Promise<{ text: string; resourceId: string; filename: string }>;
      transcribeMedia(media: Blob, options?: { signal?: AbortSignal }): Promise<{ text: string }>;
    };
    notes: {
      query(input?: PluginNoteQuery): Promise<PluginNoteQueryResult>;
      queryContent(input?: PluginNoteQuery): Promise<PluginNoteContentQueryResult>;
      get(noteId: string): Promise<PluginNote>;
      editMarkdown(noteId: string, input: PluginMarkdownEditInput): Promise<PluginNote>;
      create(input: PluginNoteCreateInput): Promise<PluginNote>;
      update(noteId: string, input: PluginNoteUpdateInput): Promise<PluginNote>;
      delete(noteId: string, options?: { permanent?: boolean }): Promise<void>;
      move(noteIds: string[], notebookId: string): Promise<number>;
      pin(noteIds: string[], isPinned: boolean): Promise<number>;
      restore(noteId: string): Promise<PluginNote>;
      revisions: {
        list(noteId: string): Promise<PluginNoteRevision[]>;
        restore(noteId: string, revisionId: string): Promise<PluginNote>;
      };
    };
    notebooks: {
      list(): Promise<PluginNotebook[]>;
      create(input: { name: string; parentId?: string | null }): Promise<PluginNotebook>;
      update(notebookId: string, input: { name?: string; parentId?: string | null; sortOrder?: number }): Promise<PluginNotebook>;
      delete(notebookId: string): Promise<void>;
    };
    tags: {
      list(): Promise<PluginTag[]>;
      rename(name: string, nextName: string): Promise<number>;
      delete(name: string): Promise<number>;
    };
    templates: {
      list(): Promise<PluginTemplate[]>;
      create(input: { name: string; description?: string | null; noteId?: string; title?: string | null; contentMarkdown?: string; tags?: string[] }): Promise<PluginTemplate>;
      update(templateId: string, input: { name?: string; description?: string | null; title?: string | null; contentMarkdown?: string; tags?: string[] }): Promise<PluginTemplate>;
      delete(templateId: string): Promise<void>;
      use(templateId: string, notebookId: string): Promise<PluginNote>;
    };
    commands: {
      register(command: PluginCommand): () => void;
    };
    schedules: {
      upsert(input: PluginScheduleInput): Promise<PluginSchedule>;
      list(): Promise<PluginSchedule[]>;
      remove(key: string): Promise<void>;
    };
    events: {
      on<K extends keyof PluginEventMap>(event: K, listener: (payload: PluginEventMap[K]) => void): () => void;
    };
    storage: {
      get<T>(key: string): Promise<T | null>;
      set<T>(key: string, value: T): Promise<void>;
      remove(key: string): Promise<void>;
    };
    secrets: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<void>;
      remove(key: string): Promise<void>;
    };
    editor: {
      getSelection(): Promise<PluginEditorSelection | null>;
      getDocument(): Promise<PluginEditorDocument | null>;
      editMarkdown(edits: PluginMarkdownEdit[]): Promise<PluginEditorDocument>;
      insertEmbed(input: PluginEmbedInput): Promise<PluginEmbedInstance>;
      embeds: {
        register(renderer: PluginEmbedRenderer): () => void;
      };
      replaceSelection(contentMarkdown: string): Promise<void>;
      insertAtCursor(contentMarkdown: string): Promise<void>;
    };
    resources: {
      list(noteId?: string): Promise<PluginResource[]>;
      read(resourceId: string): Promise<Blob>;
      upload(noteId: string, file: File): Promise<PluginResource>;
      update(resourceId: string, input: { file: File; expectedContentHash: string }): Promise<PluginResource>;
      rename(resourceId: string, filename: string): Promise<PluginResource>;
      delete(resourceId: string): Promise<void>;
    };
    settings: {
      get(key: string): Promise<PluginSettingValue | null>;
      set(key: string, value: PluginSettingValue): Promise<void>;
      remove(key: string): Promise<void>;
    };
    network: {
      fetch(input: string, init?: RequestInit & { transport?: "direct" | "public" }): Promise<Response>;
    };
    ui: {
      showNotice(message: string): void;
      openNote(noteId: string, options?: PluginOpenNoteOptions): Promise<void>;
      panels: {
        register(panel: PluginPanel): () => void;
        open(panelId: string, options?: PluginPanelOpenOptions): Promise<void>;
      };
    };
  }

  export interface EdgeEverPlugin {
    activate(context: PluginContext): void | (() => void) | Promise<void | (() => void)>;
    deactivate?(): void | Promise<void>;
  }
}
