import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import type { AgentFileEntry } from "@pi-control/protocol";
import { usePiControl } from "../store";
import { api } from "../api";

/* ------------------------------------------------------------------ */
/* File tree (lazy)                                                    */
/* ------------------------------------------------------------------ */

interface TreeNode extends AgentFileEntry {
  children?: TreeNode[];
  loaded?: boolean;
  open?: boolean;
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
const MAX_EDIT_BYTES = 512 * 1024;

function isTextLike(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return !IMAGE_EXT.includes(ext);
}

function languageFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) return javascript({ jsx: true, typescript: ["ts", "tsx"].includes(ext) });
  if (ext === "json") return json();
  if (ext === "md" || ext === "markdown") return markdown();
  if (ext === "css" || ext === "scss") return css();
  if (["html", "htm", "svg"].includes(ext)) return html();
  if (["py"].includes(ext)) return python();
  return undefined;
}

function FileTree({
  workspaceId,
  entries,
  selected,
  onSelect,
  onRefresh,
}: {
  workspaceId: string;
  entries: TreeNode[];
  selected: string | null;
  onSelect: (entry: TreeNode) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = async (entry: TreeNode) => {
    const next = { ...expanded, [entry.path]: !expanded[entry.path] };
    setExpanded(next);
    if (!entry.loaded) {
      try {
        const { entries: children } = await api.listFiles(workspaceId, entry.path);
        entry.children = children as TreeNode[];
        entry.loaded = true;
        entry.open = next[entry.path];
        onRefresh();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const renderEntry = (entry: TreeNode, depth: number) => (
    <div key={entry.path}>
      <div
        className={`file-tree-row ${selected === entry.path ? "selected" : ""}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => {
          if (entry.type === "dir") void toggle(entry);
          else onSelect(entry);
        }}
      >
        <span className="file-tree-icon">{entry.type === "dir" ? (expanded[entry.path] ? "▾" : "▸") : "·"}</span>
        <span className="file-tree-name" title={entry.path}>
          {entry.name}
        </span>
      </div>
      {entry.type === "dir" && expanded[entry.path] && entry.children && (
        <div>{entry.children.map((child) => renderEntry(child, depth + 1))}</div>
      )}
    </div>
  );

  return <div className="file-tree">{entries.map((entry) => renderEntry(entry, 0))}</div>;
}

/* ------------------------------------------------------------------ */
/* Files view                                                          */
/* ------------------------------------------------------------------ */

export function FilesView() {
  const activeWorkspaceId = usePiControl((s) => s.activeWorkspaceId);
  const workspaces = usePiControl((s) => s.workspaces);
  const workspace = activeWorkspaceId ? workspaces[activeWorkspaceId] : undefined;

  const [rootEntries, setRootEntries] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [content, setContent] = useState("");
  const [encoding, setEncoding] = useState<"utf8" | "base64">("utf8");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<null | "file" | "dir">(null);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const loadRoot = async () => {
    if (!activeWorkspaceId) return;
    try {
      const { entries } = await api.listFiles(activeWorkspaceId);
      setRootEntries(entries as TreeNode[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void loadRoot();
    setSelected(null);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  const openFile = async (entry: TreeNode) => {
    if (!activeWorkspaceId) return;
    try {
      const { file } = await api.readFile(activeWorkspaceId, entry.path);
      setSelected(entry);
      setContent(file.content);
      setEncoding(file.encoding);
      setDirty(false);
      setError(file.truncated ? "File truncated at 512 KiB (display only)" : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!activeWorkspaceId || !selected) return;
    setSaving(true);
    try {
      await api.writeFile(activeWorkspaceId, selected.path, content, encoding);
      setDirty(false);
      void loadRoot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    if (!activeWorkspaceId || !createName.trim()) return;
    try {
      const base = selected?.type === "dir" ? selected.path : "";
      const target = base ? `${base}/${createName.trim()}` : createName.trim();
      if (creating === "dir") await api.mkdirFile(activeWorkspaceId, target);
      else await api.writeFile(activeWorkspaceId, target, "");
      setCreating(null);
      setCreateName("");
      void loadRoot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!activeWorkspaceId || !selected) return;
    if (!window.confirm(`Delete ${selected.path}?`)) return;
    try {
      await api.removeFile(activeWorkspaceId, selected.path, selected.type === "dir");
      setSelected(null);
      setDirty(false);
      void loadRoot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const rename = async () => {
    if (!activeWorkspaceId || !selected || !createName.trim()) return;
    try {
      const dir = selected.path.includes("/") ? selected.path.slice(0, selected.path.lastIndexOf("/") + 1) : "";
      await api.renameFile(activeWorkspaceId, selected.path, `${dir}${createName.trim()}`);
      setRenaming(false);
      setCreateName("");
      void loadRoot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const isImage = selected && IMAGE_EXT.includes(selected.name.split(".").pop()?.toLowerCase() ?? "");
  const isMarkdown = selected?.name.toLowerCase().endsWith(".md") && encoding === "utf8";

  const previewUrl = useMemo(() => {
    if (!selected || !isImage || encoding !== "base64") return null;
    const ext = selected.name.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;
    return `data:${mime};base64,${content}`;
  }, [selected, isImage, encoding, content]);

  if (!workspace) {
    return <div className="files-empty">Select or create a workspace to browse its files.</div>;
  }

  return (
    <div className="files-view">
      <div className="files-tree-pane">
        <div className="files-toolbar">
          <button className="btn btn-small" onClick={() => setCreating("file")}>
            + File
          </button>
          <button className="btn btn-small" onClick={() => setCreating("dir")}>
            + Dir
          </button>
          <button className="btn btn-small" onClick={() => void loadRoot()}>
            ⟳
          </button>
        </div>
        {creating && (
          <div className="inline-form">
            <input
              autoFocus
              placeholder={creating === "dir" ? "Folder name" : "File name"}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <div className="form-actions">
              <button className="btn btn-small" onClick={() => void create()}>
                Create
              </button>
              <button className="btn btn-small" onClick={() => setCreating(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <FileTree workspaceId={workspace.id} entries={rootEntries} selected={selected?.path ?? null} onSelect={(e) => void openFile(e)} onRefresh={() => void loadRoot()} />
      </div>
      <div className="files-editor-pane">
        {!selected ? (
          <div className="files-empty">Select a file to edit.</div>
        ) : (
          <>
            <div className="files-editor-header">
              <span className="files-path">{selected.path}</span>
              <span className="files-toolbar">
                {renaming ? (
                  <input
                    autoFocus
                    className="rename-input"
                    defaultValue={selected.name}
                    onChange={(e) => setCreateName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void rename()}
                  />
                ) : (
                  <button className="btn btn-small" onClick={() => setRenaming(true)}>
                    Rename
                  </button>
                )}
                <button className="btn btn-small btn-danger" onClick={() => void remove()}>
                  Delete
                </button>
                {dirty && (
                  <button className="btn btn-small btn-primary" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                )}
              </span>
            </div>
            {isImage && previewUrl ? (
              <div className="files-preview">
                <img src={previewUrl} alt={selected.name} />
              </div>
            ) : isMarkdown ? (
              <div className="files-preview md-preview">
                <pre>{content}</pre>
              </div>
            ) : (
              <CodeMirror
                value={content}
                height="100%"
                extensions={[languageFor(selected.name)].filter(Boolean) as never[]}
                onChange={(value) => {
                  setContent(value);
                  setDirty(true);
                }}
                theme="dark"
              />
            )}
            {error && <div className="form-error files-error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
