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
  Position,
  useReactFlow,
  type Node,
  type NodeChange,
  type Edge,
  type EdgeChange,
  type Connection,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseMarkdown, collectOutlineNodes } from '../../services/mindmap/parser';
import type { MindNode } from '../../services/mindmap/types';
import { layoutMindMap, measureMindMapNode } from '../../services/mindmap/layout';
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
import { FreeFlowLayer } from './FreeFlowLayer';
import {
  branchColor,
  getTheme,
  loadThemeId,
  saveThemeId,
  type MindMapThemeId,
} from './themes';
import {
  loadCanvasSidecar,
  saveCanvasSidecar,
  recordColor,
  type CustomFlowEdge as CustomFlowEdgeT,
  type FreeFlowLine,
  type FreeFlowEndpoint,
  type AnnotationGroup,
  type MindMapCanvasSidecar,
  type EdgeDisplayMode,
  DEFAULT_GROUP_STYLE,
} from '../../services/mindmap/canvasSidecar';
import {
  resolveEndpoint,
  snapEndpoint,
  snapLineEnd,
  tidyFreeLines,
  type FlowPoint,
  type FreeLineNodeBox,
} from '../../services/mindmap/freeFlow';
import {
  computeExportBounds,
  snapshotToPng,
  snapshotToPdf,
} from './exportImage';
import { save as tauriSave, writeFile as tauriWriteFile } from '../../services/exportTauri';
import { useCanvasHistory } from './useCanvasHistory';

const nodeTypes = { custom: CustomNode, annotation: AnnotationGroupNode };
const edgeTypes = { custom: CustomEdge, customFlow: CustomFlowEdge };

const STRUCTURE_HOVER_MS = 400;
const NODE_SIZE_SCALE = { xs: 0.78, s: 0.9, m: 1, l: 1.16, xl: 1.34 } as const;
const FALLBACK_NODE_HANDLES = [
  { type: 'target', position: Position.Left, x: -7, y: 13, width: 14, height: 14 },
  { type: 'source', position: Position.Right, x: 113, y: 13, width: 14, height: 14 },
];

interface MindMapPaneProps {
  markdown: string;
  /** 虚拟根显示名（文档无大标题时的中心节点文本），一般传文件名 */
  fileName?: string;
  /** 位置 sidecar 的文档稳定键；已落盘文件传绝对路径。 */
  filePath?: string;
  /** 编辑回写。缺省时画布只读。 */
  onChange?: (markdown: string) => void;
}

function lineIndexOf(nodeId: string): number | null {
  if (!nodeId.startsWith('n')) return null;
  const n = Number(nodeId.slice(1));
  return Number.isFinite(n) ? n : null;
}

function isNodeId(id: string): boolean {
  return id.startsWith('n');
}

function isFreeLineId(id: string): boolean {
  return id.startsWith('fl-');
}

function isDrawingTool(tool: MindMapTool): boolean {
  return tool === 'draw-arrow' || tool === 'draw-line';
}

// P0-2: 节点 ID 映射：lineIndex (n0/n1) ↔ positionKey (稳定内容路径)
// 用于 customEdges/groups 的持久化引用
function buildPositionKeyMap(doc: { root: MindNode }): Map<string, string> {
  const map = new Map<string, string>(); // positionKey → nodeId
  const setAlias = (key: string | undefined, nodeId: string): void => {
    if (key && !map.has(key)) map.set(key, nodeId);
  };
  const walk = (node: MindNode): void => {
    if (node.kind !== 'root') {
      const nodeId = `n${node.lineIndex}`;
      setAlias(node.id, nodeId);
      setAlias(node.text, nodeId);
      setAlias(nodeId, nodeId);
    }
    for (const child of node.children) walk(child);
  };
  walk(doc.root);
  return map;
}

function sidecarLookupKeys(node: MindNode | undefined, nodeId: string, positionKey: string): string[] {
  return [...new Set([positionKey, node?.text, nodeId].filter((key): key is string => !!key))];
}

function defaultEdgeId(): string {
  return `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultGroupId(): string {
  return `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultFreeLineId(): string {
  return `fl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
  const documentKey = filePath || fileName;
  const [sidecar, setSidecar] = useState<MindMapCanvasSidecar>(() => loadCanvasSidecar(documentKey));
  const [edgeMode, setEdgeMode] = useState<EdgeDisplayMode>(() => loadCanvasSidecar(documentKey).edgeMode);
  const [pendingStructure, setPendingStructure] = useState<StructureHover | null>(null);
  const {
    recordBefore: recordHistoryBefore,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
    canUndo,
    canRedo,
  } = useCanvasHistory();

  // P0-1: 跟踪当前 sidecar 所属的文档 key，防止文件切换时的数据污染
  const [hydratedDocumentKey, setHydratedDocumentKey] = useState<string | null>(documentKey);
  const pendingNewLineRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    nodeId: string;
    initialPositions: Map<string, { x: number; y: number }>;
    altKey: boolean;
  } | null>(null);
  const freeLineDraftRef = useRef<{
    start: FlowPoint;
    startEndpoint: FreeFlowEndpoint;
    arrow: FreeFlowLine['arrow'];
  } | null>(null);
  const ignoreNextPaneClickRef = useRef(false);
  const [freeLineDraft, setFreeLineDraft] = useState<{ start: FlowPoint; end: FlowPoint; arrow: FreeFlowLine['arrow'] } | null>(null);
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
    setSidecar(loaded);
    setEdgeMode(loaded.edgeMode);
    resetHistory();
    // P0-1: 标记 sidecar 已完全加载到这个 documentKey
    setHydratedDocumentKey(documentKey);
  }, [documentKey, resetHistory]);

  // sidecar 持久化
  useEffect(() => {
    // P0-1: 只有当 sidecar 已经完全加载到当前 documentKey 时才持久化
    // 防止文件切换时用旧 sidecar 覆盖新文件
    if (!documentKey || hydratedDocumentKey !== documentKey) return;
    saveCanvasSidecar(documentKey, sidecar);
  }, [documentKey, sidecar, hydratedDocumentKey]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // 操作前记录快照，撤销栈保存不可变的 markdown + sidecar 状态。
  const recordBefore = useCallback((md: string, sc: MindMapCanvasSidecar) => {
    recordHistoryBefore({ markdown: md, sidecar: sc });
  }, [recordHistoryBefore]);

  const undo = useCallback(() => {
    const entry = undoHistory({ markdown, sidecar });
    if (!entry) return;
    setSidecar(entry.sidecar);
    setEdgeMode(entry.sidecar.edgeMode);
    onChangeRef.current?.(entry.markdown);
  }, [undoHistory, markdown, sidecar]);

  const redo = useCallback(() => {
    const entry = redoHistory({ markdown, sidecar });
    if (!entry) return;
    setSidecar(entry.sidecar);
    setEdgeMode(entry.sidecar.edgeMode);
    onChangeRef.current?.(entry.markdown);
  }, [redoHistory, markdown, sidecar]);

  const applyInsert = useCallback((result: EditResult | null) => {
    if (!result || !onChangeRef.current) return;
    recordBefore(markdown, sidecar);
    onChangeRef.current(result.markdown);
    const id = `n${result.newLineIndex}`;
    setSelectedIds([id]);
    setEditingId(id);
    pendingNewLineRef.current = result.newLineIndex;
  }, [markdown, sidecar, recordBefore]);

  const commitEdit = useCallback((lineIndex: number, text: string) => {
    const current = docRef.current;
    const trimmed = text.trim();
    setEditingId(null);
    if (trimmed === '' && pendingNewLineRef.current === lineIndex) {
      // 新建节点未输入任何文字：回收，不在 MD 里留空标题行
      const md = deleteNode(current, lineIndex);
      pendingNewLineRef.current = null;
      if (md !== null) {
        recordBefore(markdown, sidecar);
        onChangeRef.current?.(md);
      }
      setSelectedIds([]);
      return;
    }
    pendingNewLineRef.current = null;
    const md = editNodeText(current, lineIndex, trimmed);
    if (md !== null && md !== current.lines.join('\n')) {
      recordBefore(markdown, sidecar);
      onChangeRef.current?.(md);
    }
  }, [markdown, sidecar, recordBefore]);

  const cancelEdit = useCallback((lineIndex: number) => {
    const current = docRef.current;
    setEditingId(null);
    if (pendingNewLineRef.current === lineIndex) {
      const md = deleteNode(current, lineIndex);
      pendingNewLineRef.current = null;
      if (md !== null) {
        recordBefore(markdown, sidecar);
        onChangeRef.current?.(md);
      }
      setSelectedIds([]);
    }
  }, [markdown, sidecar, recordBefore]);

  const startEdit = useCallback((nodeId: string) => {
    if (!onChangeRef.current) return;
    setEditingId(nodeId);
    setSelectedIds([nodeId]);
  }, []);

  // 派生节点：layout → 加 sidecar 坐标 → 加主题/选择/编辑态。
  const derivedNodes = useMemo(() => {
    // 用 collectOutlineNodes 拿真实节点行号 → 估算尺寸（与 layout.ts 一致）。
    const outlineNodes = collectOutlineNodes(doc.root);
    const nodeList = doc.root.kind === 'root' ? [doc.root, ...outlineNodes] : outlineNodes;
    const sizeByLine = new Map<number, { w: number; h: number }>();
    for (const n of nodeList) {
      const size = measureMindMapNode(n, n === doc.root);
      sizeByLine.set(n.lineIndex, { w: size.width, h: size.height });
    }
    const layout = layoutMindMap(doc.root);
    return layout.nodes.map((n) => {
      const positionKey = String(n.data.positionKey ?? n.id);
      const lineIndex = Number(n.id.slice(1));
      const outlineNode = nodeList.find((node) => node.lineIndex === lineIndex);
      const lookupKeys = sidecarLookupKeys(outlineNode, n.id, positionKey);
      const pos = lookupKeys.map((key) => sidecar.positions[key]).find(Boolean) ?? n.position;
      const isSelected = selectedIds.includes(n.id);
      // P0-9: 获取 per-node 样式
      const nodeStyle = lookupKeys.map((key) => sidecar.nodeStyles[key]).find(Boolean);
      const baseSize = sizeByLine.get(lineIndex) ?? { w: 120, h: 40 };
      const scale = NODE_SIZE_SCALE[nodeStyle?.sizeLevel ?? 'm'];
      const size = {
        w: Math.round(baseSize.w * scale),
        h: Math.round(baseSize.h * scale),
      };
      return {
        ...n,
        position: pos,
        type: 'custom',
        width: size.w,
        height: size.h,
        connectable: tool === 'connect',
        handles: FALLBACK_NODE_HANDLES,
        data: {
          ...n.data,
          width: size.w,
          height: size.h,
          theme,
          editable: !!onChange,
          isSelected,
          isEditing: n.id === editingId,
          isConnectMode: tool === 'connect',
          onStartEdit: startEdit,
          onCommitEdit: commitEdit,
          onCancelEdit: cancelEdit,
          perNodeStyle: nodeStyle, // P0-9: 传递 per-node 样式到 CustomNode
        },
      } as Node;
    });
  }, [doc, theme, onChange, selectedIds, editingId, tool, sidecar.positions, sidecar.nodeStyles, startEdit, commitEdit, cancelEdit]);

  // 派生 edges：父子边（依 edgeMode）+ 自定义流程边 + P1-1 临时结构预览线
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

    // P1-1: 临时结构预览连接线（虚线箭头，绿色表示确认）
    let previewEdges: Edge[] = [];
    if (pendingStructure) {
      const elapsed = Date.now() - pendingStructure.startAt;
      const confirmed = elapsed >= STRUCTURE_HOVER_MS;
      const sourceNode = derivedNodes.find(n => n.id === pendingStructure.sourceId);
      const targetNode = derivedNodes.find(n => n.id === pendingStructure.targetId);
      if (sourceNode && targetNode) {
        previewEdges = [{
          id: 'preview-structure',
          source: pendingStructure.sourceId,
          target: pendingStructure.targetId,
          type: 'customFlow',
          style: {
            stroke: confirmed ? '#22c55e' : '#3b82f6',
            strokeWidth: 2,
            strokeDasharray: confirmed ? 'none' : '5,5',
          },
          markerEnd: 'url(#mm-flow-arrow)',
          data: {
            edge: {
              id: 'preview-structure',
              source: pendingStructure.sourceId,
              target: pendingStructure.targetId,
              arrow: 'one-way',
              shape: 'straight',
              dash: confirmed ? 'solid' : 'dashed',
              color: confirmed ? '#22c55e' : '#3b82f6',
              width: 2,
            },
          },
          zIndex: 1000, // 确保在正常边之上
        }];
      }
    }

    return [...tree, ...customEdges, ...previewEdges];
  }, [doc, theme, sidecar.customEdges, selectedIds, edgeMode, pendingStructure, derivedNodes]);

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
        recordBefore(markdown, sidecar);
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
  }, [derivedNodes, doc, selectedIds, markdown, sidecar, recordBefore]);

  const freeLineNodeBoxes = useMemo<FreeLineNodeBox[]>(() => (
    derivedNodes
      .filter((n) => isNodeId(n.id))
      .map((n) => {
        const width = (n.data as { width?: number })?.width ?? n.width ?? 120;
        const height = (n.data as { height?: number })?.height ?? n.height ?? 40;
        return { id: n.id, x: n.position.x, y: n.position.y, width, height };
      })
  ), [derivedNodes]);

  // React Flow 节点由 finalNodes 派生；边保留受控状态以支持内部 edge change。
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    setEdges(derivedEdges);
  }, [derivedEdges, setEdges]);

  // 节点变化：位置更新写回 sidecar；节点数组本身保持由 markdown/sidecar 派生。
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position) {
        const nodeId = ch.id;
        if (nodeId.startsWith('g:')) {
          const currentNodes = rf.getNodes();
          const groupId = nodeId.slice(2);
          setSidecar((sc) => {
            const group = sc.groups.find((g) => g.id === groupId);
            if (!group) return sc;
            const oldNode = currentNodes.find((n) => n.id === nodeId);
            if (!oldNode) return sc;
            const dx = ch.position!.x - oldNode.position.x;
            const dy = ch.position!.y - oldNode.position.y;
            if (dx === 0 && dy === 0) return sc;
            const positions = { ...sc.positions };
            for (const mid of group.memberIds) {
              const key = mid; // P0-2: memberIds 已经是 positionKey
              const cur = positions[key]
                ?? derivedNodes.find((dn) => String(dn.data.positionKey ?? '') === key || dn.id === key)?.position;
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
  }, [derivedNodes, rf]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, [setEdges]);

  // 单击节点：根据 detail 选择；detail=2 立即进入编辑
  const handleNodeClick = useCallback((event: ReactMouseEvent, node: Node) => {
    if (isDrawingTool(tool)) return;
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
  }, [selectedIds, startEdit, tool]);

  const handleEdgeClick = useCallback((event: ReactMouseEvent, edge: Edge) => {
    setSelectedIds((prev) => {
      if (event.shiftKey) {
        if (prev.includes(edge.id)) return prev.filter((id) => id !== edge.id);
        return [...prev, edge.id];
      }
      return [edge.id];
    });
    wrapperRef.current?.focus();
  }, []);

  const handleNodeDoubleClick = useCallback((_: ReactMouseEvent, node: Node) => {
    if (!onChangeRef.current) return;
    startEdit(node.id);
  }, [startEdit]);

  const handlePaneClick = useCallback(() => {
    if (ignoreNextPaneClickRef.current) {
      ignoreNextPaneClickRef.current = false;
      return;
    }
    setSelectedIds([]);
    setEditingId(null);
  }, []);

  const handleFreeLineSelect = useCallback((id: string, additive: boolean) => {
    setSelectedIds((prev) => {
      if (additive) {
        if (prev.includes(id)) return prev.filter((item) => item !== id);
        return [...prev, id];
      }
      return [id];
    });
    wrapperRef.current?.focus();
  }, []);

  const handlePaneMouseDown = useCallback((event: ReactMouseEvent) => {
    if (!isDrawingTool(tool) || event.button !== 0) return;
    event.preventDefault();
    const raw = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const startEndpoint = snapEndpoint(raw, freeLineNodeBoxes, { bindToNode: !event.altKey });
    const start = resolveEndpoint(startEndpoint, freeLineNodeBoxes);
    const arrow: FreeFlowLine['arrow'] = tool === 'draw-arrow' ? 'one-way' : 'none';
    freeLineDraftRef.current = { start, startEndpoint, arrow };
    setFreeLineDraft({ start, end: start, arrow });
    setSelectedIds([]);
    wrapperRef.current?.focus();
  }, [tool, rf, freeLineNodeBoxes]);

  const handlePaneMouseMove = useCallback((event: ReactMouseEvent) => {
    const draft = freeLineDraftRef.current;
    if (!draft || !isDrawingTool(tool)) return;
    const rawEnd = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const endEndpoint = snapLineEnd(draft.start, rawEnd, freeLineNodeBoxes, {
      bindToNode: !event.altKey,
      angleSnap: event.shiftKey,
    });
    setFreeLineDraft({
      start: draft.start,
      end: resolveEndpoint(endEndpoint, freeLineNodeBoxes),
      arrow: draft.arrow,
    });
  }, [tool, rf, freeLineNodeBoxes]);

  const handlePaneMouseUp = useCallback((event: ReactMouseEvent) => {
    const draft = freeLineDraftRef.current;
    if (!draft || !isDrawingTool(tool)) return;
    event.preventDefault();
    freeLineDraftRef.current = null;
    setFreeLineDraft(null);
    const rawEnd = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const endEndpoint = snapLineEnd(draft.start, rawEnd, freeLineNodeBoxes, {
      bindToNode: !event.altKey,
      angleSnap: event.shiftKey,
    });
    const end = resolveEndpoint(endEndpoint, freeLineNodeBoxes);
    if (Math.hypot(end.x - draft.start.x, end.y - draft.start.y) < 6) {
      ignoreNextPaneClickRef.current = true;
      return;
    }
    const line: FreeFlowLine = {
      id: defaultFreeLineId(),
      start: draft.startEndpoint,
      end: endEndpoint,
      arrow: draft.arrow,
      shape: 'straight',
      dash: 'solid',
      color: '#475569',
      width: 1.8,
    };
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, freeLines: [...sc.freeLines, line] }));
    setSelectedIds([line.id]);
    ignoreNextPaneClickRef.current = true;
  }, [tool, rf, freeLineNodeBoxes, markdown, sidecar, recordBefore]);

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

  // Escape 退出画线/连接模式
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && (tool === 'connect' || isDrawingTool(tool))) {
        e.preventDefault();
        freeLineDraftRef.current = null;
        setFreeLineDraft(null);
        setTool('select');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  // P1-1: 结构拖动检测：只有进入节点中央区域（内缩20%）才开始400ms确认
  const findNodeAt = useCallback((pointerFlow: { x: number; y: number }, excludeId: string | null): { id: string; cx: number; cy: number } | null => {
    for (const n of derivedNodes) {
      if (n.id === excludeId) continue;
      const li = lineIndexOf(n.id);
      if (li === null) continue;
      const w = (n.data as { width?: number })?.width as number ?? 120;
      const h = (n.data as { height?: number })?.height as number ?? 40;
      // P1-1: 只有进入中央区域（内缩20%）才触发
      const insetX = w * 0.2;
      const insetY = h * 0.2;
      const centerX = n.position.x + w / 2;
      const centerY = n.position.y + h / 2;
      const halfW = w / 2 - insetX;
      const halfH = h / 2 - insetY;
      if (pointerFlow.x >= centerX - halfW && pointerFlow.x <= centerX + halfW
          && pointerFlow.y >= centerY - halfH && pointerFlow.y <= centerY + halfH) {
        return { id: n.id, cx: centerX, cy: centerY };
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
    const currentNodes = rf.getNodes();
    for (const id of dragIds) {
      const n = currentNodes.find((nn) => nn.id === id);
      if (n) initial.set(id, { x: n.position.x, y: n.position.y });
    }
    recordBefore(markdown, sidecar);
    dragRef.current = {
      pointerId: 0,
      startX: 0,
      startY: 0,
      nodeId: node.id,
      initialPositions: initial,
      altKey: false,
    };
  }, [editingId, selectedIds, rf, tool, markdown, sidecar, recordBefore]);

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
  }, [pendingStructure, clearStructureHover]);

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
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, customEdges: [...sc.customEdges, newEdge] }));
  }, [markdown, sidecar, recordBefore]);

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
    recordBefore(markdown, sidecar);
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
  }, [derivedNodes, selectedIds, markdown, sidecar, recordBefore]);

  // 自动布局：清空 positions + 重新 fitView
  const handleAutoLayout = useCallback(() => {
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, positions: {} }));
    requestAnimationFrame(() => {
      rf.fitView({ duration: 300, padding: 0.15 });
    });
  }, [markdown, sidecar, recordBefore, rf]);

  const handleTidyCanvas = useCallback(() => {
    const selectedNodeIds = selectedIds.filter(isNodeId);
    const selectedLineIds = selectedIds.filter(isFreeLineId);
    const targetNodeIds = selectedIds.length === 0 ? derivedNodes.map((n) => n.id).filter(isNodeId) : selectedNodeIds;
    const targetLineIds = selectedIds.length === 0 ? sidecar.freeLines.map((line) => line.id) : selectedLineIds;
    const nodeTargets = derivedNodes.filter((n) => targetNodeIds.includes(n.id));
    const lineTargets = sidecar.freeLines.filter((line) => targetLineIds.includes(line.id));
    if (nodeTargets.length < 2 && lineTargets.length === 0) return;

    const positionPatches = new Map<string, { x: number; y: number }>();
    if (nodeTargets.length >= 2) {
      const boxes: NodeBox[] = nodeTargets.map((n) => {
        const width = (n.data as { width?: number })?.width ?? n.width ?? 120;
        const height = (n.data as { height?: number })?.height ?? n.height ?? 40;
        return { id: n.id, x: n.position.x, y: n.position.y, width, height };
      });
      const minX = Math.min(...boxes.map((box) => box.x));
      const maxX = Math.max(...boxes.map((box) => box.x + box.width));
      const minY = Math.min(...boxes.map((box) => box.y));
      const maxY = Math.max(...boxes.map((box) => box.y + box.height));
      const horizontal = maxX - minX >= maxY - minY;
      const distributed = boxes.length >= 3
        ? distributeNodes(boxes, horizontal ? 'horizontal' : 'vertical')
        : [];
      const distributedBoxes = distributed.length === boxes.length
        ? boxes.map((box, index) => ({ ...box, ...distributed[index] }))
        : boxes;
      const aligned = alignNodes(distributedBoxes, horizontal ? 'center-v' : 'center-h');
      const finalPositions = aligned.length === boxes.length ? aligned : distributed;
      for (let index = 0; index < boxes.length; index++) {
        const pos = finalPositions[index];
        if (!pos) continue;
        const li = lineIndexOf(boxes[index].id);
        if (li === null) continue;
        const node = collectOutlineNodes(docRef.current.root).find((item) => item.lineIndex === li);
        if (node) positionPatches.set(node.id, pos);
      }
    }

    const tidiedLines = lineTargets.length > 0 ? tidyFreeLines(lineTargets, freeLineNodeBoxes) : [];
    recordBefore(markdown, sidecar);
    setSidecar((sc) => {
      const positions = { ...sc.positions };
      for (const [key, pos] of positionPatches) positions[key] = pos;
      const tidiedById = new Map(tidiedLines.map((line) => [line.id, line] as const));
      return {
        ...sc,
        positions,
        freeLines: sc.freeLines.map((line) => tidiedById.get(line.id) ?? line),
      };
    });
  }, [selectedIds, derivedNodes, sidecar, freeLineNodeBoxes, markdown, recordBefore]);

  const handleClearFreeLines = useCallback(() => {
    if (sidecar.freeLines.length === 0) {
      setSelectedIds((prev) => prev.filter((id) => !isFreeLineId(id)));
      return;
    }
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, freeLines: [] }));
    setSelectedIds((prev) => prev.filter((id) => !isFreeLineId(id)));
  }, [markdown, sidecar, recordBefore]);

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
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, groups: [...sc.groups, group] }));
    setSelectedIds([`g:${group.id}`]); // P0-5: 标注框 ID 必须是 g: 前缀
  }, [selectedIds, markdown, sidecar, recordBefore]);

  // 主题切换
  const handleThemeChange = useCallback((id: MindMapThemeId) => {
    setThemeId(id);
    saveThemeId(id);
  }, []);

  // 边模式切换
  const handleEdgeModeChange = useCallback((mode: EdgeDisplayMode) => {
    recordBefore(markdown, sidecar);
    setEdgeMode(mode);
    setSidecar((sc) => ({ ...sc, edgeMode: mode }));
  }, [markdown, sidecar, recordBefore]);

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
        const lookupKeys = sidecarLookupKeys(node, id, node.id);
        const nodeStyle = lookupKeys.map((key) => sidecar.nodeStyles[key]).find(Boolean);
        const color = nodeStyle?.color ?? null; // null 表示使用主题默认颜色
        return { kind: 'node', ids: [id], color, sizeLevel: nodeStyle?.sizeLevel ?? 'm' };
      }
      if (id.startsWith('e-') || sidecar.customEdges.some((e) => e.id === id)) {
        const e = sidecar.customEdges.find((ee) => ee.id === id);
        if (e) return { kind: 'edge', ids: [id], style: e };
        return null;
      }
      if (isFreeLineId(id)) {
        const line = sidecar.freeLines.find((item) => item.id === id);
        if (line) {
          return {
            kind: 'edge',
            ids: [id],
            style: { id: line.id, source: '', target: '', arrow: line.arrow, shape: line.shape, dash: line.dash, color: line.color, width: line.width },
          };
        }
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
        const lookupKeys = sidecarLookupKeys(node, id, node.id);
        const nodeStyle = lookupKeys.map((key) => sidecar.nodeStyles[key]).find(Boolean);
        return nodeStyle?.color ?? null;
      }));
      const sizes = new Set(selectedIds.map((id) => {
        const li = lineIndexOf(id);
        if (li === null) return 'm';
        const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        if (!node) return 'm';
        const lookupKeys = sidecarLookupKeys(node, id, node.id);
        const nodeStyle = lookupKeys.map((key) => sidecar.nodeStyles[key]).find(Boolean);
        return nodeStyle?.sizeLevel ?? 'm';
      }));
      // 如果所有节点颜色相同（包括都是 null），显示该颜色；否则显示 null
      const color = colors.size === 1 ? [...colors][0] : null;
      const sizeLevel = sizes.size === 1 ? [...sizes][0] : null;
      return { kind: 'node', ids: selectedIds, color, sizeLevel };
    }
    if (selectedIds.every((id) => isFreeLineId(id) || sidecar.customEdges.some((e) => e.id === id))) {
      const first = selectedIds[0];
      const custom = sidecar.customEdges.find((e) => e.id === first);
      const free = sidecar.freeLines.find((line) => line.id === first);
      const style = custom ?? (free
        ? { id: free.id, source: '', target: '', arrow: free.arrow, shape: free.shape, dash: free.dash, color: free.color, width: free.width }
        : null);
      if (style) return { kind: 'edge', ids: selectedIds, style };
    }
    return null;
  }, [selectedIds, sidecar.groups, sidecar.customEdges, sidecar.freeLines, sidecar.nodeStyles]);

  // 上下文栏动作
  const applyColorToSelected = useCallback((color: string) => {
    if (!styleTarget) return;
    if (styleTarget.kind === 'edge') {
      recordBefore(markdown, sidecar);
      setSidecar((sc) => {
        recordColor(sc, color);
        return {
          ...sc,
          customEdges: sc.customEdges.map((e) =>
            styleTarget.ids.includes(e.id) ? { ...e, color } : e,
          ),
          freeLines: sc.freeLines.map((line) =>
            styleTarget.ids.includes(line.id) ? { ...line, color } : line,
          ),
        };
      });
    } else if (styleTarget.kind === 'group') {
      recordBefore(markdown, sidecar);
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
      recordBefore(markdown, sidecar);
      setSidecar((sc) => {
        recordColor(sc, color);
        const nodeStyles = { ...sc.nodeStyles };
        for (const id of styleTarget.ids) {
          const li = lineIndexOf(id);
          if (li === null) continue;
          const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
          if (!node) continue;
          // 使用 positionKey (node.id) 作为 key
          const current = nodeStyles[node.id] ?? {};
          nodeStyles[node.id] = { ...current, color };
        }
        return { ...sc, nodeStyles };
      });
    }
  }, [styleTarget, markdown, sidecar, recordBefore]);

  const applyNodeSizeToSelected = useCallback((sizeLevel: 'xs' | 's' | 'm' | 'l' | 'xl') => {
    if (!styleTarget || styleTarget.kind !== 'node') return;
    recordBefore(markdown, sidecar);
    setSidecar((sc) => {
      const nodeStyles = { ...sc.nodeStyles };
      for (const id of styleTarget.ids) {
        const li = lineIndexOf(id);
        if (li === null) continue;
        const node = collectOutlineNodes(docRef.current.root).find((n) => n.lineIndex === li);
        if (!node) continue;
        const current = nodeStyles[node.id] ?? {};
        nodeStyles[node.id] = { ...current, sizeLevel };
      }
      return { ...sc, nodeStyles };
    });
  }, [styleTarget, markdown, sidecar, recordBefore]);

  const applyEdgeStyle = useCallback((patch: Partial<CustomFlowEdgeT>) => {
    if (!styleTarget || styleTarget.kind !== 'edge') return;
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({
      ...sc,
      customEdges: sc.customEdges.map((e) =>
        styleTarget.ids.includes(e.id) ? { ...e, ...patch } : e,
      ),
      freeLines: sc.freeLines.map((line) =>
        styleTarget.ids.includes(line.id)
          ? {
              ...line,
              arrow: patch.arrow ?? line.arrow,
              shape: patch.shape ?? line.shape,
              dash: patch.dash ?? line.dash,
              color: patch.color ?? line.color,
              width: patch.width ?? line.width,
            }
          : line,
      ),
    }));
  }, [styleTarget, markdown, sidecar, recordBefore]);

  const applyGroupStyle = useCallback((patch: Partial<AnnotationGroup['style']>) => {
    if (!styleTarget || styleTarget.kind !== 'group') return;
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({
      ...sc,
      groups: sc.groups.map((g) =>
        styleTarget.ids.includes(g.id) ? { ...g, style: { ...g.style, ...patch } } : g,
      ),
    }));
  }, [styleTarget, markdown, sidecar, recordBefore]);

  const deleteSelectedEdges = useCallback(() => {
    if (!styleTarget || styleTarget.kind !== 'edge') return;
    const ids = new Set(styleTarget.ids);
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({
      ...sc,
      customEdges: sc.customEdges.filter((e) => !ids.has(e.id)),
      freeLines: sc.freeLines.filter((line) => !ids.has(line.id)),
    }));
    setSelectedIds((prev) => prev.filter((id) => !ids.has(id)));
  }, [styleTarget, markdown, sidecar, recordBefore]);

  const deleteSelectedGroups = useCallback(() => {
    if (!styleTarget || styleTarget.kind !== 'group') return;
    const ids = new Set(styleTarget.ids.map((id) => id.startsWith('g:') ? id.slice(2) : id));
    recordBefore(markdown, sidecar);
    setSidecar((sc) => ({ ...sc, groups: sc.groups.filter((g) => !ids.has(g.id)) }));
    setSelectedIds((prev) => prev.filter((id) => !id.startsWith('g:') || !ids.has(id.slice(2))));
  }, [styleTarget, markdown, sidecar, recordBefore]);

  // 键盘操作：Enter / Tab / Shift+Tab / Space / F2 / Delete
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (!onChangeRef.current) return;
      const ae = document.activeElement;
      // P1-3: input/textarea编辑态Delete只删文字（由浏览器原生处理）
      if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement) return;
      // P1-3: contenteditable编辑态通过检查属性判断
      if (ae && ae.getAttribute('contenteditable') === 'true') return;
      if (editingId) return;
      // Cmd/Ctrl + Z / Shift+Z
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      // P1-3: Delete键处理（支持多选删除边/框，单选删除节点/边/框）
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        // 多选：只删除边和框，不删除节点
        if (selectedIds.length > 1) {
          const groupIds = new Set(selectedIds.filter((id) => id.startsWith('g:')).map((id) => id.slice(2)));
          const edgeIds = new Set(selectedIds.filter((id) => !id.startsWith('n') && !id.startsWith('g:')));
          // P1-3: 多选包含节点时不得误删节点，只删除边和框
          if (groupIds.size > 0 || edgeIds.size > 0) {
            recordBefore(markdown, sidecar);
            setSidecar((sc) => ({
              ...sc,
              customEdges: sc.customEdges.filter((e) => !edgeIds.has(e.id)),
              freeLines: sc.freeLines.filter((line) => !edgeIds.has(line.id)),
              groups: sc.groups.filter((g) => !groupIds.has(g.id)),
            }));
            setSelectedIds((prev) => prev.filter((id) => {
              if (id.startsWith('g:')) return !groupIds.has(id.slice(2));
              if (!id.startsWith('n')) return !edgeIds.has(id);
              return true; // 节点保持选中
            }));
          }
          return;
        }
        // 单选：删除节点、边或框
        if (selectedIds.length === 1) {
          const id = selectedIds[0];
          // 删除标注框
          if (id.startsWith('g:')) {
            const gid = id.slice(2);
            recordBefore(markdown, sidecar);
            setSidecar((sc) => ({ ...sc, groups: sc.groups.filter((g) => g.id !== gid) }));
            setSelectedIds([]);
            return;
          }
          // 删除边
          if (!id.startsWith('n')) {
            if (sidecar.customEdges.some((ee) => ee.id === id) || sidecar.freeLines.some((line) => line.id === id)) {
              recordBefore(markdown, sidecar);
              setSidecar((sc) => ({
                ...sc,
                customEdges: sc.customEdges.filter((ee) => ee.id !== id),
                freeLines: sc.freeLines.filter((line) => line.id !== id),
              }));
              setSelectedIds([]);
              return;
            }
            return;
          }
          // 删除节点
          const li = lineIndexOf(id);
          if (li === null) return;
          const current = docRef.current;
          if (li === current.root.lineIndex) return;
          const node = collectOutlineNodes(current.root).find((n) => n.lineIndex === li);
          if (!node) return;
          if (node.children.length > 0 && !window.confirm('删除该节点及其全部子节点？')) return;
          const md = deleteNode(current, li);
          if (md !== null) {
            recordBefore(markdown, sidecar);
            onChangeRef.current(md);
            setSelectedIds([]);
          }
        }
        return;
      }
      // P1-3: 其他编辑键只在单选时生效
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
          recordBefore(markdown, sidecar);
          onChangeRef.current(md);
          setSelectedIds([]);
        }
      } else if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        applyInsert(insertChild(current, li));
      } else if ((e.key === ' ' || e.code === 'Space' || e.key === 'F2') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        startEdit(sel);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, selectedIds, applyInsert, startEdit, recordBefore, undo, redo, markdown, sidecar]);

  // 导出
  // P1-5: 导出参数包含format, scale, background
  const handleExport = useCallback(async (format: 'png' | 'pdf', scale?: number, background?: 'transparent' | 'white') => {
    const element = wrapperRef.current?.querySelector('.react-flow') as HTMLElement | null;
    if (!element) return;
    const allNodesRf = rf.getNodes();
    const allEdgesRf = rf.getEdges();
    const freeLinePoints = sidecar.freeLines.flatMap((line) => [
      resolveEndpoint(line.start, freeLineNodeBoxes),
      resolveEndpoint(line.end, freeLineNodeBoxes),
    ]);
    const bounds = computeExportBounds(rf, allNodesRf, allEdgesRf, freeLinePoints);
    const baseName = (fileName.replace(/\.[^.]+$/, '') || 'mindmap');
    try {
      if (format === 'png') {
        // P1-5: PNG 1x/2x真传参数，背景可选白底/透明
        const pngScale = scale ?? 2;
        const pngBackground = background ?? 'white';
        const blob = await snapshotToPng(rf, element, bounds, { background: pngBackground, scale: pngScale });
        const path = await tauriSave({
          defaultPath: `${baseName}.png`,
          filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        });
        if (!path) return;
        const buffer = await blob.arrayBuffer();
        await tauriWriteFile(path, new Uint8Array(buffer));
      } else {
        const blob = await snapshotToPdf(rf, element, bounds, `${baseName}.pdf`);
        const path = await tauriSave({
          defaultPath: `${baseName}.pdf`,
          filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
        });
        if (!path) return;
        const buffer = await blob.arrayBuffer();
        await tauriWriteFile(path, new Uint8Array(buffer));
      }
    } catch (error) {
      // P1-7: Tauri save/write失败必须在MindMapPane显示可理解错误提示
      const message = error instanceof Error ? error.message : '导出失败，请重试';
      // 简单的alert提示，实际项目可用Toast
      window.alert(`导出失败: ${message}`);
      console.error('Export error:', error);
    }
  }, [rf, fileName, sidecar.freeLines, freeLineNodeBoxes]);

  // P1-1: 节点被拖到高亮目标时：给目标加预览样式（包含确认状态）
  const derivedNodesWithHover = useMemo(() => {
    if (!pendingStructure) return derivedNodes;
    const elapsed = Date.now() - pendingStructure.startAt;
    if (elapsed < 0) return derivedNodes;
    const confirmed = elapsed >= STRUCTURE_HOVER_MS;
    return derivedNodes.map((n) => {
      if (n.id !== pendingStructure.targetId) return n;
      return {
        ...n,
        data: {
          ...n.data,
          isStructureTarget: true,
          isStructureConfirmed: confirmed, // P1-1: 传递确认状态给CustomNode
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
    return [...derivedGroups, ...derivedNodesWithHover];
  }, [derivedGroups, derivedNodesWithHover]);

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
          {(() => {
            const elapsed = Date.now() - pendingStructure.startAt;
            const confirmed = elapsed >= STRUCTURE_HOVER_MS;
            const targetNode = derivedNodes.find(n => n.id === pendingStructure.targetId);
            const targetText = targetNode ? (targetNode.data as { label?: string }).label : '目标';
            return confirmed
              ? `✓ 松手设为『${targetText}』的子节点`
              : `拖到节点中央停留 400ms：设为『${targetText}』的子节点 (${Math.ceil((STRUCTURE_HOVER_MS - elapsed) / 100) * 100}ms)`;
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
        canUndo={canUndo}
        canRedo={canRedo}
        onAutoLayout={handleAutoLayout}
        onTidyCanvas={handleTidyCanvas}
        onClearFreeLines={handleClearFreeLines}
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
        onNodeSizeChange={applyNodeSizeToSelected}
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
        nodesDraggable={!!onChange && tool !== 'connect' && !isDrawingTool(tool)}
        nodesConnectable={tool === 'connect'}
        elementsSelectable={!!onChange && !isDrawingTool(tool)}
        selectionOnDrag={!!onChange && !isDrawingTool(tool)}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        selectNodesOnDrag={!!onChange && tool !== 'connect' && !isDrawingTool(tool)}
        panOnDrag={tool !== 'connect' && !isDrawingTool(tool) ? [0, 1, 2] : false}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        onEdgeClick={handleEdgeClick}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={handlePaneClick}
        onMouseDown={handlePaneMouseDown}
        onMouseMove={handlePaneMouseMove}
        onMouseUp={handlePaneMouseUp}
      >
        {theme.nodeVariant !== 'classic' && (
          <Background variant={BackgroundVariant.Dots} gap={18} size={1.5} color="#e2dfdb" />
        )}
        <Controls showInteractive={false} />
        {theme.nodeVariant !== 'classic' && <MiniMap pannable zoomable />}
        <FreeFlowLayer
          lines={sidecar.freeLines}
          nodes={freeLineNodeBoxes}
          selectedIds={selectedIds}
          draft={freeLineDraft}
          onSelect={handleFreeLineSelect}
        />
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
