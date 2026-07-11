/**
 * 脑图 + 流程图画布：M-C 起的完整编辑闭环。
 *
 * 数据流：MD 仍是唯一源（编辑/结构变化 → onChange(md)）。
 * sidecar：positions / customEdges / groups / edgeMode / colorHistory，
 * 按 documentKey 隔离，节点重命名/移动时失配回退自动布局（设计文档 §3.4）。
 *
 * 交互：
 *   - 选择模式：单击切换选中；Shift+单击多选；Cmd/Ctrl+A 全选；Shift+拖动框选
 *   - 拖动：默认自由拖动更新 sidecar 坐标；按住 Alt/Option 强制自由
 *   - 拖到另一节点中央 400ms：目标高亮 + 「设为『目标』的子节点」预告，松手触发
 *     moveSubtreeAsLastChild，MD 回写并清掉被移动子树旧坐标
 *   - 选中多个：可对齐/等间距/添加标注框
 *   - 连接模式：从节点连接点拖到另一节点创建自定义流程箭头，独立于 MD
 *   - 工具栏：选择/连接/自动布局/对齐/连接线模式/标注框/撤销重做/导出
 *   - 上下文样式栏：选中节点/箭头/框后浮出
 *   - 撤销/重做：内部历史栈（MD 字符串 + sidecar），Cmd/Ctrl+Z & Cmd/Ctrl+Shift+Z
 *
 * 编辑键位（画布聚焦、未在输入态）：
 *   Enter / Tab / Shift+Tab / Space / F2 / Delete 沿用 M-C 已锁定的语义，
 *   Delete 在输入框内由浏览器原生处理（删文字，不删节点/箭头）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeChange,
  type Edge,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseMarkdown, collectOutlineNodes } from '../../services/mindmap/parser';
import type { MindNode } from '../../services/mindmap/types';
import { layoutMindMap } from '../../services/mindmap/layout';
import {
  deleteNode,
  editNodeText,
  insertChild,
  insertSibling,
  moveSubtreeAsLastChild,
  promoteNode,
  type EditResult,
} from '../../services/mindmap/edit';
import { alignNodes, distributeNodes, type NodeBox } from '../../services/mindmap/align';
import { CustomNode } from './CustomNode';
import { CustomEdge } from './CustomEdge';
import { CustomFlowEdge, EdgeMarkerDefs } from './CustomFlowEdge';
import { AnnotationGroupNode, computeGroupBbox, makeGroupNode } from './AnnotationGroupNode';
import { MindMapToolbar, type MindMapTool } from './MindMapToolbar';
import { SelectionContextBar, type StyleTarget } from './SelectionContextBar';
import {
  branchColor,
  getTheme,
  loadThemeId,
  saveThemeId,
  type MindMapThemeId,
} from './themes';
import {
  emptySidecar,
  loadCanvasSidecar,
  saveCanvasSidecar,
  recordColor,
  type CustomFlowEdge as CustomFlowEdgeT,
  type AnnotationGroup,
  type MindMapCanvasSidecar,
  type EdgeDisplayMode,
  DEFAULT_GROUP_STYLE,
} from '../../services/mindmap/canvasSidecar';
import {
  computeExportBounds,
  snapshotToPng,
  snapshotToPdf,
} from './exportImage';
import { save as tauriSave, writeFile as tauriWriteFile } from '../../services/exportTauri';
import { loadMindMapPositions, saveMindMapPositions } from '../../services/mindmap/positionStore';

const nodeTypes = { custom: CustomNode, annotation: AnnotationGroupNode };
const edgeTypes = { custom: CustomEdge, customFlow: CustomFlowEdge };

const STRUCTURE_HOVER_MS = 400;
const HISTORY_LIMIT = 64;

interface MindMapPaneProps {
  markdown: string;
  /** 虚拟根显示名（文档无大标题时的中心节点文本），一般传文件名 */
  fileName?: string;
  /** 位置 sidecar 的文档稳定键；已落盘文件传绝对路径。 */
  filePath?: string;
  /** 编辑回写。缺省时画布只读。 */
  onChange?: (markdown: string) => void;
}

interface HistoryEntry {
  markdown: string;
  sidecar: MindMapCanvasSidecar;
}

function lineIndexOf(nodeId: string): number | null {
  if (!nodeId.startsWith('n')) return null;
  const n = Number(nodeId.slice(1));
  return Number.isFinite(n) ? n : null;
}

function isNodeId(id: string): boolean {
  return id.startsWith('n');
}

// P0-2: 节点 ID 映射：lineIndex (n0/n1) ↔ positionKey (稳定内容路径)
// 用于 customEdges/groups 的持久化引用
function buildPositionKeyMap(doc: { root: MindNode }): Map<string, string> {
  const map = new Map<string, string>(); // positionKey → nodeId
  const walk = (node: MindNode): void => {
    if (node.kind !== 'root') {
      map.set(node.id, `n${node.lineIndex}`);
    }
    for (const child of node.children) walk(child);
  };
  walk(doc.root);
  return map;
}

function defaultEdgeId(): string {
  return `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultGroupId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

interface StructureHover {
  sourceId: string;
  targetId: string;
  startAt: number;
}

export function MindMapPane(props: MindMapPaneProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  );
}

function MindMapInner({ markdown, fileName = '', filePath = '', onChange }: MindMapPaneProps): React.ReactElement {
  const [themeId, setThemeId] = useState<MindMapThemeId>(loadThemeId);
  const theme = getTheme(themeId);
  const [tool, setTool] = useState<MindMapTool>('select');
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [edgeMode, setEdgeMode] = useState<EdgeDisplayMode>('mindmap');
  const [sidecar, setSidecar] = useState<MindMapCanvasSidecar>(() => emptySidecar());
  const [pendingStructure, setPendingStructure] = useState<StructureHover | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const documentKey = filePath || fileName;
  // P0-1: 跟踪当前 sidecar 所属的文档 key，防止文件切换时的数据污染
  const [hydratedDocumentKey, setHydratedDocumentKey] = useState<string | null>(null);
  const pendingNewLineRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    nodeId: string;
    initialPositions: Map<string, { x: number; y: number }>;
    altKey: boolean;
    beforeMarkdown: string; // P0-3: 记录拖动前的 markdown，用于 dragStop 时形成历史事务
    beforeSidecar: MindMapCanvasSidecar; // P0-3: 记录拖动前的 sidecar
  } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const rf = useReactFlow();

  // 解析：MD 变化时重解析（只读——不会写回）。
  const doc = useMemo(() => parseMarkdown(markdown, fileName), [markdown, fileName]);
  const docRef = useRef(doc);
  docRef.current = doc;

  // 文档 key 变化时重读 sidecar
  useEffect(() => {
    const loaded = loadCanvasSidecar(documentKey);
    // 兼容 v1：把旧 localStorage 里的 positions 合并过来（v1 仍在原地写）
    if (documentKey) {
      const legacy = loadMindMapPositions(documentKey);
      for (const [k, v] of Object.entries(legacy)) {
        if (!loaded.positions[k]) loaded.positions[k] = v;
      }
    }
    setSidecar(loaded);
    setEdgeMode(loaded.edgeMode);
    setHistory([]);
    setHistoryIndex(-1);
    // P0-1: 标记 sidecar 已完全加载到这个 documentKey
    setHydratedDocumentKey(documentKey);
  }, [documentKey]);

  // sidecar 持久化
  useEffect(() => {
    // P0-1: 只有当 sidecar 已经完全加载到当前 documentKey 时才持久化
    // 防止文件切换时用旧 sidecar 覆盖新文件
    if (!documentKey || hydratedDocumentKey !== documentKey) return;
    saveCanvasSidecar(documentKey, sidecar);
    // v1 兼容：把 positions 也写一份旧 key（v1 在新版上仍然能读出来）
    saveMindMapPositions(documentKey, sidecar.positions);
  }, [documentKey, sidecar, hydratedDocumentKey]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 把当前 (markdown, sidecar) 推入历史。
  // P0-3: 历史必须存不可变的结果快照，防止后续修改影响历史
  const pushHistory = useCallback((md: string, sc: MindMapCanvasSidecar) => {
    // 深拷贝 sidecar 以确保历史中的对象不可变
    const sidecarCopy = JSON.parse(JSON.stringify(sc)) as MindMapCanvasSidecar;
    setHistory((prev) => {
      const truncated = prev.slice(0, historyIndex + 1);
      truncated.push({ markdown: md, sidecar: sidecarCopy });
      while (truncated.length > HISTORY_LIMIT) truncated.shift();
      return truncated;
    });
    setHistoryIndex((idx) => Math.min(idx + 1, HISTORY_LIMIT - 1));
  }, [historyIndex]);

  const restoreHistory = useCallback((target: number) => {
    if (target < 0 || target >= history.length) return;
    const entry = history[target];
    setSidecar(entry.sidecar);
    setEdgeMode(entry.sidecar.edgeMode);
    onChangeRef.current?.(entry.markdown);
    setHistoryIndex(target);
  }, [history]);

  const undo = useCallback(() => {
    if (historyIndex > 0) restoreHistory(historyIndex - 1);
  }, [historyIndex, restoreHistory]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1);
  }, [historyIndex, history.length, restoreHistory]);

  const applyInsert = useCallback((result: EditResult | null) => {
    if (!result || !onChangeRef.current) return;
    pushHistory(markdown, sidecar);
    onChangeRef.current(result.markdown);
    const id = `n${result.newLineIndex}`;
    setSelectedIds([id]);
    setEditingId(id);
    pendingNewLineRef.current = result.newLineIndex;
  }, [markdown, sidecar, pushHistory]);

  const commitEdit = useCallback((lineIndex: number, text: string) => {
    const current = docRef.current;
    const trimmed = text.trim();
    setEditingId(null);
    if (trimmed === '' && pendingNewLineRef.current === lineIndex) {
      // 新建节点未输入任何文字：回收，不在 MD 里留空标题行
      const md = deleteNode(current, lineIndex);
      pendingNewLineRef.current = null;
      if (md !== null) {
        pushHistory(markdown, sidecar);
        onChangeRef.current?.(md);
      }
      setSelectedIds([]);
      return;
    }
    pendingNewLineRef.current = null;
    const md = editNodeText(current, lineIndex, trimmed);
    if (md !== null && md !== current.lines.join('\n')) {
      pushHistory(markdown, sidecar);
      onChangeRef.current?.(md);
    }
  }, [markdown, sidecar, pushHistory]);

  const cancelEdit = useCallback((lineIndex: number) => {
    const current = docRef.current;
    setEditingId(null);
    if (pendingNewLineRef.current === lineIndex) {
      const md = deleteNode(current, lineIndex);
      pendingNewLineRef.current = null;
      if (md !== null) {
        pushHistory(markdown, sidecar);
        onChangeRef.current?.(md);
      }
      setSelectedIds([]);
    }
  }, [markdown, sidecar, pushHistory]);

  const startEdit = useCallback((nodeId: string) => {
    if (!onChangeRef.current) return;
    setEditingId(nodeId);
    setSelectedIds([nodeId]);
  }, []);

  // 派生节点：layout → 加 sidecar 坐标 → 加主题/选择/编辑态。
  const derivedNodes = useMemo(() => {
    // 用 collectOutlineNodes 拿真实节点行号 → 估算尺寸（与 layout.ts 一致）。
    const nodeList = collectOutlineNodes(doc.root);
    const sizeByLine = new Map<number, { w: number; h: number }>();
    for (const n of nodeList) {
      const text = n.text;
      const w = Math.min(300, Math.max(80, text.length * 8.4 + 30));
      const lines = Math.max(1, Math.ceil(text.length / 22));
      const h = Math.max(40, lines * 20 + 18);
      sizeByLine.set(n.lineIndex, { w, h });
    }
    const layout = layoutMindMap(doc.root);
    return layout.nodes.map((n) => {
      const positionKey = String(n.data.positionKey ?? n.id);
      const pos = sidecar.positions[positionKey] ?? n.position;
      const lineIndex = Number(n.id.slice(1));
      const size = sizeByLine.get(lineIndex) ?? { w: 120, h: 40 };
      const isSelected = selectedIds.includes(n.id);
      // P0-9: 获取 per-node 样式
      const nodeStyle = sidecar.nodeStyles[positionKey];
      return {
        ...n,
        position: pos,
        type: 'custom',
        width: size.w,
        height: size.h,
        data: {
          ...n.data,
          width: size.w,
          height: size.h,
          theme,
          editable: !!onChange,
          isSelected,
          isEditing: n.id === editingId,
          onStartEdit: startEdit,
          onCommitEdit: commitEdit,
          onCancelEdit: cancelEdit,
          perNodeStyle: nodeStyle, // P0-9: 传递 per-node 样式到 CustomNode
        },
      } as Node;
    });
  }, [doc, theme, onChange, selectedIds, editingId, sidecar.positions, sidecar.nodeStyles, startEdit, commitEdit, cancelEdit]);

  // 派生 edges：父子边（依 edgeMode）+ 自定义流程边。
  const derivedEdges = useMemo<Edge[]>(() => {
    const tree: Edge[] = [];
    if (edgeMode !== 'none') {
      const layout = layoutMindMap(doc.root);
      for (const e of layout.edges) {
        const style: React.CSSProperties = {
          stroke: branchColor(theme, (e.data?.branchIndex as number | undefined) ?? -1),
          strokeWidth: theme.edgeWidth,
        };
        if (edgeMode === 'flow') {
          style.stroke = '#475569';
          style.strokeWidth = 1.5;
        }
        tree.push({
          ...e,
          type: 'custom',
          data: {
            ...e.data,
            edgeVariant: edgeMode === 'flow' ? 'straight' : theme.edgeVariant,
            flowMode: edgeMode === 'flow',
          },
          style,
          markerEnd: edgeMode === 'flow' ? 'url(#mm-flow-arrow)' : undefined,
        });
      }
    }
    // P0-2: 将 positionKey 映射回当前的 n{lineIndex}，找不到则清理 dangling 引用
    const positionKeyToNodeId = buildPositionKeyMap(doc);
    const customEdges: Edge[] = sidecar.customEdges
      .map((ce) => {
        const mappedSource = positionKeyToNodeId.get(ce.source);
        const mappedTarget = positionKeyToNodeId.get(ce.target);
        if (!mappedSource || !mappedTarget) return null; // 引用失效，不渲染
        return {
          id: ce.id,
          source: mappedSource,
          target: mappedTarget,
          type: 'customFlow',
          data: { edge: ce },
          selected: selectedIds.includes(ce.id),
        } as Edge;
      })
      .filter((e): e is Edge => e !== null);
    return [...tree, ...customEdges];
  }, [doc, theme, sidecar.customEdges, selectedIds, edgeMode]);

  // 标注框：成员位置变化时实时重算 bbox。
  const derivedGroups = useMemo<Node[]>(() => {
    if (sidecar.groups.length === 0) return [];
    const byLineIndex = new Map<number, { x: number; y: number; width: number; height: number }>();
    for (const n of derivedNodes) {
      const li = lineIndexOf(n.id);
      if (li === null) continue;
      const w = (n.data as { width?: number })?.width ?? n.width ?? 120;
      const h = (n.data as { height?: number })?.height ?? n.height ?? 40;
      byLineIndex.set(li, { x: n.position.x, y: n.position.y, width: w, height: h });
    }
    // P0-2: 将 positionKey 映射回当前的 n{lineIndex}
    const positionKeyToNodeId = buildPositionKeyMap(doc);
    const nodes: Node[] = [];
    for (const g of sidecar.groups) {
      const memberBoxes = g.memberIds
        .map((positionKey) => positionKeyToNodeId.get(positionKey)) // P0-2: positionKey → nodeId
        .map((nodeId) => (nodeId === undefined ? undefined : lineIndexOf(nodeId)))
        .map((li) => (li === null || li === undefined ? undefined : byLineIndex.get(li)));
      const bbox = computeGroupBbox(memberBoxes);
      if (!bbox) continue; // P0-2: 引用失效时隐藏 dangling group
      // P0-6: 传递标题编辑回调
      const handleTitleChange = (newTitle: string) => {
        pushHistory(markdown, sidecar);
        setSidecar((sc) => ({
          ...sc,
          groups: sc.groups.map((grp) =>
            grp.id === g.id ? { ...grp, title: newTitle } : grp,
          ),
        }));
      };
      nodes.push(makeGroupNode(g, bbox, selectedIds.includes(`g:${g.id}`), handleTitleChange)); // P0-5: 使用 g: 前缀
    }
    return nodes;
  }, [sidecar.groups, derivedNodes, selectedIds, markdown, sidecar, pushHistory]);

  const allNodes: Node[] = useMemo(() => [...derivedGroups, ...derivedNodes], [derivedGroups, derivedNodes]);

  // React Flow 受控状态。直接用 useState 持有节点，避免 useNodesState 的内部规范化
  // 把 group 节点（zIndex=-1 / type='group'）过滤掉。
  const [nodes, setNodes] = useState<Node[]>(allNodes);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    setNodes(allNodes);
  }, [allNodes]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  // 节点变化：位置更新要写回 sidecar（拖动过程中不记录历史）
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      return next;
    });
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        const nodeId = ch.id;
        if (nodeId.startsWith('g:')) {
          // 标注框整体拖动：按 offset 平移其所有成员
          const groupId = nodeId.slice(2);
          setSidecar((sc) => {
            const group = sc.groups.find((g) => g.id === groupId);
            if (!group) return sc;
            const oldNode = nodes.find((n) => n.id === nodeId);
            if (!oldNode) return sc;
            const dx = ch.position!.x - oldNode.position.x;
            const dy = ch.position!.y - oldNode.position.y;
            if (dx === 0 && dy === 0) return sc;
            const positions = { ...sc.positions };
            for (const mid of group.memberIds) {
              const key = mid; // P0-2: memberIds 已经是 positionKey
              const cur = positions[key] ?? derivedNodes.find((dn) => dn.id === key)?.position;
              if (cur) positions[key] = { x: cur.x + dx, y: cur.y + dy };
            }
            return { ...sc, positions };
          });
          continue;
        }
        if (!isNodeId(nodeId)) continue;
        const li = lineIndexOf(nodeId);
        if (li === null) continue;
        // 用 collectOutlineNodes 拿 positionKey
        const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        const positionKey = node?.id ?? nodeId;
        setSidecar((sc) => ({
          ...sc,
          positions: { ...sc.positions, [positionKey]: { x: ch.position!.x, y: ch.position!.y } },
        }));
      }
    }
    // 选择变化
    if (changes.some((c) => c.type === 'select')) {
      // 选择变化由 onSelectionChange 统一接管，这里只兜住位置更新
    }
  }, [setNodes, nodes, derivedNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, [setEdges]);

  // 选择变化：多选同步
  const handleSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const ids = [...params.nodes.map((n) => n.id), ...params.edges.map((e) => e.id)];
    setSelectedIds(ids);
  }, []);

  // 单击节点：根据 detail 选择；detail=2 立即进入编辑
  const handleNodeClick = useCallback((event: ReactMouseEvent, node: Node) => {
    if ((event.detail >= 2 || selectedIds.length === 1 && selectedIds[0] === node.id) && onChangeRef.current) {
      startEdit(node.id);
      return;
    }
    setSelectedIds((prev) => {
      if (event.shiftKey) {
        if (prev.includes(node.id)) return prev.filter((id) => id !== node.id);
        return [...prev, node.id];
      }
      return [node.id];
    });
    wrapperRef.current?.focus();
  }, [selectedIds, startEdit]);

  const handleNodeDoubleClick = useCallback((_: ReactMouseEvent, node: Node) => {
    if (!onChangeRef.current) return;
    startEdit(node.id);
  }, [startEdit]);

  const handlePaneClick = useCallback(() => {
    setSelectedIds([]);
    setEditingId(null);
  }, []);

  // Cmd/Ctrl+A
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const ae = document.activeElement;
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedIds(derivedNodes.map((n) => n.id));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [derivedNodes]);

  // Escape 退出连接模式
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && tool === 'connect') {
        e.preventDefault();
        setTool('select');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  // 结构拖动检测
  const findNodeAt = useCallback((pointerFlow: { x: number; y: number }, excludeId: string | null): { id: string; cx: number; cy: number } | null => {
    for (const n of derivedNodes) {
      if (n.id === excludeId) continue;
      const li = lineIndexOf(n.id);
      if (li === null) continue;
      const w = (n.data as { width?: number })?.width as number ?? 120;
      const h = (n.data as { height?: number })?.height as number ?? 40;
      if (pointerFlow.x >= n.position.x && pointerFlow.x <= n.position.x + w
          && pointerFlow.y >= n.position.y && pointerFlow.y <= n.position.y + h) {
        return { id: n.id, cx: n.position.x + w / 2, cy: n.position.y + h / 2 };
      }
    }
    return null;
  }, [derivedNodes]);

  const startStructureHover = useCallback((sourceId: string, targetId: string) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    const startAt = Date.now();
    setPendingStructure({ sourceId, targetId, startAt });
    hoverTimerRef.current = window.setTimeout(() => {
      // 维持 pendingStructure，组件渲染时根据 elapsed 决定是否高亮
      setPendingStructure((cur) => (cur && cur.sourceId === sourceId && cur.targetId === targetId ? { ...cur } : cur));
    }, STRUCTURE_HOVER_MS);
  }, []);

  const clearStructureHover = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setPendingStructure(null);
  }, []);

  // 拖动开始：锁定起点
  const handleNodeDragStart = useCallback((_event: React.MouseEvent | TouchEvent | MouseEvent, node: Node) => {
    if (editingId) return;
    if (node.id.startsWith('g:')) return;
    if (tool === 'connect') return;
    const initial = new Map<string, { x: number; y: number }>();
    const dragIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
    for (const id of dragIds) {
      const n = nodes.find((nn) => nn.id === id);
      if (n) initial.set(id, { x: n.position.x, y: n.position.y });
    }
    // P0-3: 记录拖动前的状态，在 dragStop 时形成一次事务
    dragRef.current = {
      pointerId: 0,
      startX: 0,
      startY: 0,
      nodeId: node.id,
      initialPositions: initial,
      altKey: false,
      beforeMarkdown: markdown,
      beforeSidecar: JSON.parse(JSON.stringify(sidecar)) as MindMapCanvasSidecar,
    };
  }, [editingId, selectedIds, nodes, tool, markdown, sidecar]);

  // 拖动过程：结构预览（高亮+hover timer）
  const handleNodeDrag = useCallback((event: React.MouseEvent | TouchEvent | MouseEvent, node: Node) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (node.id.startsWith('g:')) return;
    drag.altKey = 'altKey' in event ? event.altKey : false;
    if (drag.altKey) {
      clearStructureHover();
      return;
    }
    const li = lineIndexOf(node.id);
    if (li === null) return;
    if (li === docRef.current.root.lineIndex) {
      clearStructureHover();
      return;
    }
    // 鼠标当前 flow 坐标
    const pointer = rf.screenToFlowPosition({
      x: 'clientX' in event ? event.clientX : 0,
      y: 'clientY' in event ? event.clientY : 0,
    });
    const target = findNodeAt(pointer, node.id);
    if (!target) {
      clearStructureHover();
      return;
    }
    const targetLi = lineIndexOf(target.id);
    if (targetLi === null || targetLi === li) {
      clearStructureHover();
      return;
    }
    // 合法性：target 不能是 source 的后代
    const isDescendant = (parentLine: number, candidate: number): boolean => {
      const findNode = (n: MindNode): MindNode | null => {
        if (n.lineIndex === parentLine) return n;
        for (const c of n.children) {
          const r = findNode(c);
          if (r) return r;
        }
        return null;
      };
      const node = findNode(docRef.current.root);
      if (!node) return false;
      const walk = (n: MindNode): boolean => {
        if (n.lineIndex === candidate) return true;
        for (const c of n.children) if (walk(c)) return true;
        return false;
      };
      return walk(node);
    };
    if (isDescendant(li, targetLi)) {
      clearStructureHover();
      return;
    }
    if (pendingStructure && pendingStructure.sourceId === node.id && pendingStructure.targetId === target.id) {
      return;
    }
    startStructureHover(node.id, target.id);
  }, [clearStructureHover, findNodeAt, pendingStructure, rf, startStructureHover]);

  // 拖动结束：触发结构移动或回写自由坐标
  const handleNodeDragStop = useCallback((_event: React.MouseEvent | TouchEvent | MouseEvent, node: Node) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (node.id.startsWith('g:')) return;
    if (drag.altKey) {
      clearStructureHover();
      // P0-3: 自由拖动，检查位置是否真正改变，形成一次历史事务
      const current = nodes.find((n) => n.id === node.id);
      if (current) {
        const before = drag.initialPositions.get(node.id);
        if (before && (before.x !== current.position.x || before.y !== current.position.y)) {
          // 位置改变，记录历史
          pushHistory(drag.beforeMarkdown, drag.beforeSidecar);
        }
      }
      return;
    }
    const li = lineIndexOf(node.id);
    if (li === null) return;
    if (li === docRef.current.root.lineIndex) {
      clearStructureHover();
      return;
    }
    const isStructureConfirmed = pendingStructure
      && pendingStructure.sourceId === node.id
      && Date.now() - pendingStructure.startAt >= STRUCTURE_HOVER_MS - 30; // 容忍 30ms 抖动
    if (isStructureConfirmed) {
      const targetLi = lineIndexOf(pendingStructure!.targetId);
      if (targetLi === null) {
        clearStructureHover();
        return;
      }
      const md = moveSubtreeAsLastChild(docRef.current, li, targetLi);
      clearStructureHover();
      if (md !== null && onChangeRef.current) {
        // P0-3: 结构移动，形成一次历史事务
        pushHistory(drag.beforeMarkdown, drag.beforeSidecar);
        onChangeRef.current(md);
        // 清掉被移动子树旧坐标：被移动子树里所有老 content-path key 都没意义了。
        setSidecar((sc) => {
          const newDoc = parseMarkdown(md);
          const newPositionKeys = new Set(collectOutlineNodes(newDoc.root).map((n) => n.id));
          // 旧 doc 里 source 子树的所有 lineIndex 对应的节点，全部从新 doc 中按 text+level 找；
          // 简单实现：直接把所有「老 doc 里 source 子树中节点的 id」从 positions 中删除。
          const oldDocRoot = docRef.current.root;
          const sourceNode = collectOutlineNodes(oldDocRoot).find((n) => n.lineIndex === li);
          if (!sourceNode) return sc;
          const subtreeIds = new Set<string>();
          const walk = (n: MindNode): void => {
            subtreeIds.add(n.id);
            for (const c of n.children) walk(c);
          };
          walk(sourceNode);
          const newPositions: Record<string, { x: number; y: number }> = {};
          for (const [k, v] of Object.entries(sc.positions)) {
            if (subtreeIds.has(k)) continue; // 老坐标在重命名/移动后失配，让自动布局接管
            newPositions[k] = v;
          }
          void newPositionKeys;
          return { ...sc, positions: newPositions };
        });
        // 重新选中移到新位置上的节点（用同样的 text+level 找回新 lineIndex）
        const newDoc2 = parseMarkdown(md);
        const oldNode = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        if (oldNode) {
          const moved = collectOutlineNodes(newDoc2.root).find(
            (n) => n.text === oldNode.text && n.kind === oldNode.kind,
          );
          if (moved) setSelectedIds([`n${moved.lineIndex}`]);
        }
        return;
      }
      // 结构移动失败：回退自由坐标（用户能直观看到为啥失败）
      return;
    }
    // 自由拖动：位置已在 React Flow 状态；这里同步到 sidecar
    clearStructureHover();
    // P0-3: 检查位置是否真正改变，形成一次历史事务
    const current = nodes.find((n) => n.id === node.id);
    if (current) {
      const before = drag.initialPositions.get(node.id);
      if (before && (before.x !== current.position.x || before.y !== current.position.y)) {
        // 位置改变，记录历史
        pushHistory(drag.beforeMarkdown, drag.beforeSidecar);
      }
    }
  }, [pendingStructure, clearStructureHover, markdown, sidecar, pushHistory, nodes]);

  // 连接模式：onConnect
  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    // P0-2: 将临时的 n{lineIndex} 转换为稳定的 positionKey 保存
    const sourceLi = lineIndexOf(connection.source);
    const targetLi = lineIndexOf(connection.target);
    if (sourceLi === null || targetLi === null) return;

    const sourceNode = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === sourceLi);
    const targetNode = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === targetLi);
    if (!sourceNode || !targetNode) return;

    const newEdge: CustomFlowEdgeT = {
      id: defaultEdgeId(),
      source: sourceNode.id, // P0-2: 保存 positionKey 而非 n{lineIndex}
      target: targetNode.id,
      arrow: 'one-way',
      shape: 'straight',
      dash: 'solid',
      color: '#475569',
      width: 1.5,
    };
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, customEdges: [...sc.customEdges, newEdge] }));
  }, [markdown, sidecar, pushHistory]);

  // 对齐/等间距
  const applyAlign = useCallback((kind: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' | 'distribute-h' | 'distribute-v') => {
    const targets = derivedNodes.filter((n) => selectedIds.includes(n.id));
    if (targets.length < 2) return;
    const boxes: NodeBox[] = targets.map((n) => {
      const w = (n.data as { width?: number })?.width as number ?? 120;
      const h = (n.data as { height?: number })?.height as number ?? 40;
      return { id: n.id, x: n.position.x, y: n.position.y, width: w, height: h };
    });
    let newPositions: { x: number; y: number }[];
    if (kind === 'distribute-h') {
      newPositions = distributeNodes(boxes, 'horizontal');
    } else if (kind === 'distribute-v') {
      newPositions = distributeNodes(boxes, 'vertical');
    } else if (kind === 'left' || kind === 'center-h' || kind === 'right') {
      newPositions = alignNodes(boxes, kind);
    } else {
      newPositions = alignNodes(boxes, kind);
    }
    if (newPositions.length !== boxes.length) return;
    const byId = new Map(boxes.map((b, i) => [b.id, newPositions[i]] as const));
    pushHistory(markdown, sidecar);
    setSidecar((sc) => {
      const positions = { ...sc.positions };
      for (const [id, pos] of byId) {
        const li = lineIndexOf(id);
        if (li === null) continue;
        const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        if (!node) continue;
        positions[node.id] = pos;
      }
      return { ...sc, positions };
    });
  }, [derivedNodes, selectedIds, markdown, sidecar, pushHistory]);

  // 自动布局：清空 positions + 重新 fitView
  const handleAutoLayout = useCallback(() => {
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, positions: {} }));
    requestAnimationFrame(() => {
      rf.fitView({ duration: 300, padding: 0.15 });
    });
  }, [markdown, sidecar, pushHistory, rf]);

  // 添加标注框
  const handleCreateGroup = useCallback(() => {
    if (selectedIds.length < 2) return;
    // P0-2: 将 n{lineIndex} 转换为 positionKey 保存
    const memberIdToPositionKey = (id: string): string | null => {
      const li = lineIndexOf(id);
      if (li === null) return null;
      const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
      return node?.id ?? null;
    };

    const memberIds = selectedIds
      .map(memberIdToPositionKey)
      .filter((id): id is string => id !== null);

    if (memberIds.length < 2) return; // 转换后有效成员不足

    const group: AnnotationGroup = {
      id: defaultGroupId(),
      title: '标注',
      memberIds,
      style: { ...DEFAULT_GROUP_STYLE },
    };
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, groups: [...sc.groups, group] }));
    setSelectedIds([`g:${group.id}`]); // P0-5: 标注框 ID 必须是 g: 前缀
  }, [selectedIds, markdown, sidecar, pushHistory]);

  // 主题切换
  const handleThemeChange = useCallback((id: MindMapThemeId) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  // 边模式切换
  const handleEdgeModeChange = useCallback((mode: EdgeDisplayMode) => {
    pushHistory(markdown, sidecar);
    setEdgeMode(mode);
    setSidecar((sc) => ({ ...sc, edgeMode: mode }));
  }, [markdown, sidecar, pushHistory]);

  // 上下文样式目标
  const styleTarget: StyleTarget | null = useMemo(() => {
    if (selectedIds.length === 0) return null;
    if (selectedIds.length === 1) {
      const id = selectedIds[0];
      if (id.startsWith('g:')) {
        const gid = id.slice(2);
        const g = sidecar.groups.find((gg) => gg.id === gid);
        if (g) return { kind: 'group', ids: [id], style: g.style };
        return null;
      }
      if (id.startsWith('n')) {
        // P0-9: 从 sidecar.nodeStyles 读取 per-node 颜色
        const li = lineIndexOf(id);
        if (li === null) return null;
        const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        if (!node) return null;
        const nodeStyle = sidecar.nodeStyles[node.id];
        const color = nodeStyle?.color ?? null; // null 表示使用主题默认颜色
        return { kind: 'node', ids: [id], color };
      }
      if (id.startsWith('e-') || sidecar.customEdges.some((e) => e.id === id)) {
        const e = sidecar.customEdges.find((ee) => ee.id === id);
        if (e) return { kind: 'edge', ids: [id], style: e };
        return null;
      }
      return null;
    }
    // 多选：节点
    if (selectedIds.every((id) => id.startsWith('n'))) {
      // P0-9: 检查所有选中的节点是否有相同颜色
      const colors = new Set(selectedIds.map((id) => {
        const li = lineIndexOf(id);
        if (li === null) return null;
        const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        if (!node) return null;
        const nodeStyle = sidecar.nodeStyles[node.id];
        return nodeStyle?.color ?? null;
      }));
      // 如果所有节点颜色相同（包括都是 null），显示该颜色；否则显示 null
      const color = colors.size === 1 ? [...colors][0] : null;
      return { kind: 'node', ids: selectedIds, color };
    }
    return null;
  }, [selectedIds, sidecar.groups, sidecar.customEdges, sidecar.positions, sidecar.nodeStyles]);

  // 上下文栏动作
  const applyColorToSelected = useCallback((color: string) => {
    if (!styleTarget) return;
    if (styleTarget.kind === 'edge') {
      pushHistory(markdown, sidecar);
      setSidecar((sc) => {
        recordColor(sc, color);
        return {
          ...sc,
          customEdges: sc.customEdges.map((e) =>
            styleTarget.ids.includes(e.id) ? { ...e, color } : e,
          ),
        };
      });
    } else if (styleTarget.kind === 'group') {
      pushHistory(markdown, sidecar);
      setSidecar((sc) => {
        recordColor(sc, color);
        return {
          ...sc,
          groups: sc.groups.map((g) =>
            styleTarget.ids.includes(g.id) ? { ...g, style: { ...g.style, color } } : g,
          ),
        };
      });
    } else if (styleTarget.kind === 'node') {
      // P0-9: 支持节点颜色
      pushHistory(markdown, sidecar);
      setSidecar((sc) => {
        recordColor(sc, color);
        const nodeStyles = { ...sc.nodeStyles };
        for (const id of styleTarget.ids) {
          const li = lineIndexOf(id);
          if (li === null) continue;
          const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
          if (!node) continue;
          // 使用 positionKey (node.id) 作为 key
          if (color === null || color === 'transparent') {
            delete nodeStyles[node.id];
          } else {
            nodeStyles[node.id] = { color };
          }
        }
        return { ...sc, nodeStyles };
      });
    }
  }, [styleTarget, markdown, sidecar, pushHistory]);

  const applyEdgeStyle = useCallback((patch: Partial<CustomFlowEdgeT>) => {
    if (!styleTarget || styleTarget.kind !== 'edge') return;
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({
      ...sc,
      customEdges: sc.customEdges.map((e) =>
        styleTarget.ids.includes(e.id) ? { ...e, ...patch } : e,
      ),
    }));
  }, [styleTarget, markdown, sidecar, pushHistory]);

  const applyGroupStyle = useCallback((patch: Partial<AnnotationGroup['style']>) => {
    if (!styleTarget || styleTarget.kind !== 'group') return;
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({
      ...sc,
      groups: sc.groups.map((g) =>
        styleTarget.ids.includes(g.id) ? { ...g, style: { ...g.style, ...patch } } : g,
      ),
    }));
  }, [styleTarget, markdown, sidecar, pushHistory]);

  const deleteSelectedEdges = useCallback(() => {
    if (!styleTarget || styleTarget.kind !== 'edge') return;
    const ids = new Set(styleTarget.ids);
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, customEdges: sc.customEdges.filter((e) => !ids.has(e.id)) }));
    setSelectedIds((prev) => prev.filter((id) => !ids.has(id)));
  }, [styleTarget, markdown, sidecar, pushHistory]);

  const deleteSelectedGroups = useCallback(() => {
    if (!styleTarget || styleTarget.kind !== 'group') return;
    const ids = new Set(styleTarget.ids.map((id) => id.startsWith('g:') ? id.slice(2) : id));
    pushHistory(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, groups: sc.groups.filter((g) => !ids.has(g.id)) }));
    setSelectedIds((prev) => prev.filter((id) => !id.startsWith('g:') || !ids.has(id.slice(2))));
  }, [styleTarget, markdown, sidecar, pushHistory]);

  // 键盘操作：Enter / Tab / Shift+Tab / Space / F2 / Delete
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!onChangeRef.current) return;
      const ae = document.activeElement;
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return;
      if (editingId) return;
      // Cmd/Ctrl + Z / Shift+Z
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (selectedIds.length !== 1) return;
      const sel = selectedIds[0];
      const li = lineIndexOf(sel);
      if (li === null) return;
      const current = docRef.current;
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        applyInsert(
          current.root.lineIndex === li
            ? insertChild(current, li)
            : insertSibling(current, li),
        );
      } else if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const md = promoteNode(current, li);
        if (md !== null) {
          pushHistory(markdown, sidecar);
          onChangeRef.current(md);
          setSelectedIds([]);
        }
      } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        applyInsert(insertChild(current, li));
      } else if ((e.key === ' ' || e.code === 'Space' || e.key === 'F2') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        startEdit(sel);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // 选中节点/边/框统一 Delete
        e.preventDefault();
        if (selectedIds.length === 1) {
          const id = selectedIds[0];
          if (id.startsWith('g:')) {
            const gid = id.slice(2);
            pushHistory(markdown, sidecar);
            setSidecar((sc) => ({ ...sc, groups: sc.groups.filter((g) => g.id !== gid) }));
            setSelectedIds([]);
            return;
          }
          if (!id.startsWith('n')) {
            if (sidecar.customEdges.some((ee) => ee.id === id)) {
              pushHistory(markdown, sidecar);
              setSidecar((sc) => ({ ...sc, customEdges: sc.customEdges.filter((ee) => ee.id !== id) }));
              setSelectedIds([]);
              return;
            }
            return;
          }
          if (li === current.root.lineIndex) return;
          const node = collectOutlineNodes(current.root).find((n) => n.lineIndex === li);
          if (!node) return;
          if (node.children.length > 0 && !window.confirm('删除该节点及其全部子节点？')) return;
          const md = deleteNode(current, li);
          if (md !== null) {
            pushHistory(markdown, sidecar);
            onChangeRef.current(md);
            setSelectedIds([]);
          }
        } else {
          // 多选：删选中的所有 customEdges + groups（不删节点）
          const groupIds = new Set(selectedIds.filter((id) => id.startsWith('g:')).map((id) => id.slice(2)));
          const edgeIds = new Set(selectedIds.filter((id) => !id.startsWith('n') && !id.startsWith('g:')));
          if (groupIds.size > 0 || edgeIds.size > 0) {
            pushHistory(markdown, sidecar);
            setSidecar((sc) => ({
              ...sc,
              customEdges: sc.customEdges.filter((e) => !edgeIds.has(e.id)),
              groups: sc.groups.filter((g) => !groupIds.has(g.id)),
            }));
            setSelectedIds((prev) => prev.filter((id) => {
              if (id.startsWith('g:')) return !groupIds.has(id.slice(2));
              if (!id.startsWith('n')) return !edgeIds.has(id);
              return true;
            }));
          }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, selectedIds, applyInsert, startEdit, pushHistory, undo, redo, markdown, sidecar]);

  // 导出
  const handleExport = useCallback(async (format: 'png' | 'pdf') => {
    const element = wrapperRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!element) return;
    const allNodesRf = rf.getNodes();
    const allEdgesRf = rf.getEdges();
    const bounds = computeExportBounds(rf, allNodesRf, allEdgesRf);
    const baseName = (fileName.replace(/\.[^.]+$/, '') || 'mindmap');
    if (format === 'png') {
      const blob = await snapshotToPng(rf, element, bounds, { background: 'white', scale: 2 });
      const path = await tauriSave({
        defaultPath: `${baseName}.png`,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      if (!path) return;
      const buffer = await blob.arrayBuffer();
      await tauriWriteFile(path, new Uint8Array(buffer));
    } else {
      const blob = await snapshotToPdf(element, `${baseName}.pdf`);
      const path = await tauriSave({
        defaultPath: `${baseName}.pdf`,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      });
      if (!path) return;
      const buffer = await blob.arrayBuffer();
      await tauriWriteFile(path, new Uint8Array(buffer));
    }
  }, [rf, fileName]);

  // 节点被拖到高亮目标时：给目标加预览样式
  const derivedNodesWithHover = useMemo(() => {
    if (!pendingStructure) return derivedNodes;
    const elapsed = Date.now() - pendingStructure.startAt;
    if (elapsed < 0) return derivedNodes;
    return derivedNodes.map((n) => {
      if (n.id !== pendingStructure.targetId) return n;
      return {
        ...n,
        data: {
          ...n.data,
          // 给目标加个内联 className hint；CustomNode 暂未消费，先放 data 上
          isStructureTarget: true,
        },
      };
    });
  }, [derivedNodes, pendingStructure]);

  // 让 hover timer 触发重渲染以刷新 elapsed
  const [, setHoverTick] = useState(0);
  useEffect(() => {
    if (!pendingStructure) return undefined;
    const id = window.setInterval(() => setHoverTick((v) => (v + 1) % 1024), 80);
    return () => window.clearInterval(id);
  }, [pendingStructure]);

  // 标注框 hover 高亮 + 选中态：合并 derivedGroups + derivedNodesWithHover
  const finalNodes = useMemo(() => {
    const groupsWithSelection = derivedGroups.map((g) => ({ ...g, selected: selectedIds.includes(g.id) } as Node));
    const regularWithSelection = derivedNodesWithHover.map((n) => {
      if (selectedIds.includes(n.id)) {
        return { ...n, selected: true } as Node;
      }
      return n;
    });
    return [...groupsWithSelection, ...regularWithSelection];
  }, [derivedGroups, derivedNodesWithHover, selectedIds]);

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      style={{ width: '100%', height: '100%', position: 'relative', outline: 'none' }}
    >
      {pendingStructure && (
        <div
          data-testid="mm-structure-hint"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 32,
            transform: 'translateX(-50%)',
            background: 'var(--accent, #3b82f6)',
            color: 'var(--surface, #fff)',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 12,
            zIndex: 9,
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          拖到节点上停留 400ms：设为子节点；松手 = {(() => {
            const elapsed = Date.now() - pendingStructure.startAt;
            return elapsed >= STRUCTURE_HOVER_MS ? '✓ 准备就绪' : `还需 ${Math.ceil((STRUCTURE_HOVER_MS - elapsed) / 100) * 100}ms`;
          })()}
        </div>
      )}
      <MindMapToolbar
        themeId={themeId}
        onThemeChange={handleThemeChange}
        activeTool={tool}
        onToolChange={setTool}
        edgeMode={edgeMode}
        onEdgeModeChange={handleEdgeModeChange}
        canUndo={historyIndex > 0}
        canRedo={historyIndex >= 0 && historyIndex < history.length - 1}
        onAutoLayout={handleAutoLayout}
        onUndo={undo}
        onRedo={redo}
        onExport={handleExport}
        selectedCount={selectedIds.length}
        onCreateGroup={handleCreateGroup}
        onAlign={applyAlign}
        onToggleThemePanel={() => setShowThemePanel((v) => !v)}
        showThemePanel={showThemePanel}
      />
      <SelectionContextBar
        target={styleTarget}
        colorHistory={sidecar.colorHistory}
        onPickColor={applyColorToSelected}
        onPickCustomColor={applyColorToSelected}
        onEdgeStyleChange={applyEdgeStyle}
        onGroupStyleChange={applyGroupStyle}
        onGroupTitleChange={() => undefined}
        onDeleteEdges={deleteSelectedEdges}
        onDeleteGroups={deleteSelectedGroups}
      />
      <ReactFlow
        nodes={finalNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        nodesDraggable={!!onChange && tool !== 'connect'}
        nodesConnectable={tool === 'connect'}
        elementsSelectable={!!onChange}
        selectionOnDrag={!!onChange}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={!!onChange && tool !== 'connect'}
        panOnDrag={tool !== 'connect' ? [0, 1, 2] : true}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onSelectionChange={handleSelectionChange}
        onConnect={handleConnect}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
      >
        {theme.nodeVariant !== 'classic' && (
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="oklch(89% 0.012 80)" />
        )}
        <Controls showInteractive={false} />
        {theme.nodeVariant !== 'classic' && <MiniMap pannable zoomable />}
        <svg style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden>
          <defs>
            <marker
              id="mm-flow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
            </marker>
            {/* P0-7：每条 customFlow 边都需要自己的 marker 定义。
                BaseEdge 用 marker-end 引用未定义的 id 时箭头不显示，这里集中注入。 */}
            {sidecar.customEdges.map((ce) => (
              <EdgeMarkerDefs key={ce.id} edge={ce} id={ce.id} />
            ))}
          </defs>
        </svg>
      </ReactFlow>
    </div>
  );
}
