/**
 * M-C 可编辑脑图画布。接收原始 Markdown，内部 parse → layout → 渲染；
 * 编辑操作（edit.ts 行级手术）产出新 Markdown 经 onChange 回写文档模型——
 * MD 仍是唯一源，画布永远从 MD 重渲染，不持有第二份文档状态。
 *
 * 键位（画布聚焦、未在输入态时）：
 *   Enter      在选中节点后插入同级空节点并进入编辑
 *   Tab        为选中节点追加子节点并进入编辑
 *   Shift+Tab  节点升一级（成为父节点的后继同级）
 *   Space / F2 / 再次点击 / 双击  编辑节点文字（Enter 提交 / Esc 取消）
 *   Delete     删除节点（有子节点时需确认）
 * 主题（PRD 项 B）：四套简洁直线条主题，右上角切换，localStorage 记住选择。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseMarkdown, collectOutlineNodes } from '../../services/mindmap/parser';
import { layoutMindMap } from '../../services/mindmap/layout';
import {
  deleteNode,
  editNodeText,
  insertChild,
  insertSibling,
  promoteNode,
  type EditResult,
} from '../../services/mindmap/edit';
import { CustomNode } from './CustomNode';
import { CustomEdge } from './CustomEdge';
import {
  MINDMAP_THEMES,
  branchColor,
  getTheme,
  loadThemeId,
  saveThemeId,
  type MindMapThemeId,
} from './themes';

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

interface MindMapPaneProps {
  markdown: string;
  /** 虚拟根显示名（文档无大标题时的中心节点文本），一般传文件名 */
  fileName?: string;
  /** 编辑回写。缺省时画布只读。 */
  onChange?: (markdown: string) => void;
}

const switcherStyle: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  zIndex: 5,
  display: 'flex',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  backgroundColor: 'var(--surface, #fff)',
  border: '1px solid var(--border, #e5e7eb)',
};

function lineIndexOf(nodeId: string): number {
  return Number(nodeId.slice(1));
}

export function MindMapPane({ markdown, fileName = '', onChange }: MindMapPaneProps): React.ReactElement {
  const [themeId, setThemeId] = useState<MindMapThemeId>(loadThemeId);
  const theme = getTheme(themeId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** 新建后尚未提交首次文字的节点行号：Esc/空提交时整节点回收，MD 不留空标题 */
  const pendingNewLineRef = useRef<number | null>(null);

  const doc = useMemo(() => parseMarkdown(markdown, fileName), [markdown, fileName]);
  const docRef = useRef(doc);
  docRef.current = doc;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const applyInsert = useCallback((result: EditResult | null) => {
    if (!result || !onChangeRef.current) return;
    onChangeRef.current(result.markdown);
    const id = `n${result.newLineIndex}`;
    setSelectedId(id);
    setEditingId(id);
    pendingNewLineRef.current = result.newLineIndex;
  }, []);

  const commitEdit = useCallback((lineIndex: number, text: string) => {
    const current = docRef.current;
    const trimmed = text.trim();
    setEditingId(null);
    if (trimmed === '' && pendingNewLineRef.current === lineIndex) {
      // 新建节点未输入任何文字：回收，不在 MD 里留空标题行
      const md = deleteNode(current, lineIndex);
      pendingNewLineRef.current = null;
      setSelectedId(null);
      if (md !== null) onChangeRef.current?.(md);
      return;
    }
    pendingNewLineRef.current = null;
    const md = editNodeText(current, lineIndex, trimmed);
    if (md !== null && md !== current.lines.join('\n')) onChangeRef.current?.(md);
  }, []);

  const cancelEdit = useCallback((lineIndex: number) => {
    const current = docRef.current;
    setEditingId(null);
    if (pendingNewLineRef.current === lineIndex) {
      const md = deleteNode(current, lineIndex);
      pendingNewLineRef.current = null;
      setSelectedId(null);
      if (md !== null) onChangeRef.current?.(md);
    }
  }, []);

  const startEdit = useCallback((nodeId: string) => {
    if (!onChangeRef.current) return;
    setSelectedId(nodeId);
    setEditingId(nodeId);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const { nodes: rawNodes, edges: rawEdges } = layoutMindMap(doc.root);
    return {
      nodes: rawNodes.map((n) => ({
        ...n,
        type: 'custom',
        data: {
          ...n.data,
          theme,
          editable: !!onChange,
          isSelected: n.id === selectedId,
          isEditing: n.id === editingId,
          onStartEdit: startEdit,
          onCommitEdit: commitEdit,
          onCancelEdit: cancelEdit,
        },
      })),
      edges: rawEdges.map((e) => ({
        ...e,
        type: 'custom',
        style: {
          stroke: branchColor(theme, (e.data?.branchIndex as number | undefined) ?? -1),
          strokeWidth: theme.edgeWidth,
        },
      })),
    };
  }, [doc, theme, onChange, selectedId, editingId, startEdit, commitEdit, cancelEdit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!onChangeRef.current || editingId) return;
      if (!selectedId) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const lineIndex = lineIndexOf(selectedId);
      const current = docRef.current;

      if (e.key === 'Enter') {
        e.preventDefault();
        // 根节点没有同级；在根上按 Enter 时按主流脑图语义创建第一个子节点。
        applyInsert(
          current.root.lineIndex === lineIndex
            ? insertChild(current, lineIndex)
            : insertSibling(current, lineIndex),
        );
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        const md = promoteNode(current, lineIndex);
        if (md !== null) {
          onChangeRef.current(md);
          setSelectedId(null);
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        applyInsert(insertChild(current, lineIndex));
      } else if (e.key === ' ' || e.code === 'Space' || e.key === 'F2') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (current.root.lineIndex === lineIndex) return;
        const node = collectOutlineNodes(current.root).find((n) => n.lineIndex === lineIndex);
        if (!node) return;
        if (node.children.length > 0 && !window.confirm('删除该节点及其全部子节点？')) return;
        const md = deleteNode(current, lineIndex);
        if (md !== null) {
          onChangeRef.current(md);
          setSelectedId(null);
        }
      }
    },
    [selectedId, editingId, applyInsert, startEdit],
  );

  // 键盘操作属于整个脑图视图，而不是某个偶然获得焦点的 DOM 容器。
  // 页面级监听消除 React Flow/WKWebView 点击后焦点落点不稳定造成的漏键。
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const selectTheme = (id: MindMapThemeId): void => {
    setThemeId(id);
    saveThemeId(id);
  };

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const handleNodeClick = useCallback((event: ReactMouseEvent, node: Node) => {
    // WKWebView / React Flow 组合下，系统双击有时只稳定送达两次 click，
    // 不再补发 dblclick。第二次 click 的 detail=2，因此在这里直接进入编辑。
    if ((event.detail >= 2 || selectedId === node.id) && onChangeRef.current) {
      startEdit(node.id);
      return;
    }
    setSelectedId(node.id);
    // WKWebView 下点击子元素不一定把焦点交给容器，显式聚焦保证键盘可用
    wrapperRef.current?.focus();
  }, [selectedId, startEdit]);

  const handleNodeDoubleClick = useCallback(
    (_: ReactMouseEvent, node: Node) => {
      if (!onChangeRef.current) return;
      startEdit(node.id);
    },
    [startEdit],
  );

  const handlePaneClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ width: '100%', height: '100%', position: 'relative', outline: 'none' }}
      tabIndex={0}
    >
      <div style={switcherStyle} role="radiogroup" aria-label="脑图主题">
        {MINDMAP_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === themeId}
            title={t.name}
            onClick={() => selectTheme(t.id)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              cursor: 'pointer',
              border: t.id === themeId ? '2px solid var(--text, #1f2937)' : '1px solid var(--border, #e5e7eb)',
              background:
                t.branchColors.length > 1
                  ? `conic-gradient(${t.branchColors.slice(0, 4).join(', ')})`
                  : t.branchColors[0],
            }}
          />
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="oklch(89% 0.012 80)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
