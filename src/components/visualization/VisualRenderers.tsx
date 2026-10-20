import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { focusGraph, layoutFocusedGraph } from '../../services/visualization/layout';
import { edgeStatusStyle, type EdgeStatus } from '../../services/visualization/legalVisuals';
import type { TraceableElement, VisualSheet } from '../../services/visualization/types';

const EDGE_STATUS_CLASS: Record<EdgeStatus, string> = {
  confirmed: 'visual-edge--confirmed',
  disputed: 'visual-edge--disputed',
  asserted: 'visual-edge--asserted',
  inferred: 'visual-edge--inferred',
  missing: 'visual-edge--missing',
};

interface RendererProps {
  sheet: VisualSheet;
  labelFor: (element: TraceableElement) => string;
  onEditLabel: (element: TraceableElement, label: string) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
}

function EditableLabel({ element, value, onChange }: {
  element: TraceableElement;
  value: string;
  onChange: (element: TraceableElement, value: string) => void;
}) {
  return (
    <input
      aria-label={`编辑展示文字：${element.label}`}
      value={value}
      onChange={(event) => onChange(element, event.currentTarget.value)}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

function nodeRole(element: TraceableElement, family: VisualSheet['family']): string {
  if (family === 'flow') return String(element.data.flowKind ?? 'step');
  if (family === 'structure-overview') {
    const level = Number(element.data.level ?? 4);
    if (level <= 1) return 'root';
    if (level === 2) return 'group';
    return 'detail';
  }
  return 'entity';
}

function GraphNodeLabel({ element, value, role, onChange }: {
  element: TraceableElement;
  value: string;
  role: string;
  onChange: (element: TraceableElement, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const finish = () => {
    const next = draft.trim() || value;
    if (next !== value) onChange(element, next);
    setEditing(false);
  };
  return (
    <div className="visual-node-content" title={element.anchor.excerpt}>
      <span className="visual-node-role">{({ root: '主题', group: '分组', detail: '要点', entity: '主体', decision: '判断', step: '步骤' } as Record<string, string>)[role] ?? '节点'}</span>
      {editing ? (
        <textarea
          aria-label={`编辑展示文字：${element.label}`}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) finish();
          }}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <button type="button" onDoubleClick={() => { setDraft(value); setEditing(true); }} onPointerDown={(event) => event.stopPropagation()}>
          {value}
        </button>
      )}
    </div>
  );
}

export function GraphRenderer({ sheet, labelFor, onEditLabel, onMoveNode }: RendererProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layout, setLayout] = useState(new Map<string, { x: number; y: number; width: number; height: number }>());
  const instanceRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const focused = useMemo(() => focusGraph(sheet, expanded), [expanded, sheet]);
  const visibleSignature = focused.nodes.map((node) => node.id).join('|');

  useEffect(() => {
    let cancelled = false;
    void layoutFocusedGraph(sheet.family, focused.nodes, focused.edges, labelFor).then((laidOut) => {
      if (cancelled) return;
      setLayout(new Map(laidOut.map((node) => [node.id, node])));
      window.setTimeout(() => instanceRef.current?.fitView({ padding: 0.22, minZoom: expanded ? 0.2 : 0.55, maxZoom: 1.05, duration: 260 }), 20);
    });
    return () => { cancelled = true; };
  }, [expanded, focused.edges, focused.nodes, labelFor, sheet.family, visibleSignature]);

  const modelNodes = useMemo<Node[]>(() => focused.nodes.map((element) => {
    const auto = layout.get(element.id);
    const saved = sheet.layout[element.id] ?? {};
    const role = nodeRole(element, sheet.family);
    return {
      id: element.id,
      position: {
        x: typeof saved.x === 'number' ? saved.x : auto?.x ?? 60,
        y: typeof saved.y === 'number' ? saved.y : auto?.y ?? 50,
      },
      style: auto ? { width: auto.width, minHeight: auto.height } : undefined,
      data: {
        label: <GraphNodeLabel element={element} value={labelFor(element)} role={role} onChange={onEditLabel} />,
      },
      className: `visual-flow-node visual-flow-node--${role}`,
    };
  }), [focused.nodes, labelFor, layout, onEditLabel, sheet.family, sheet.layout]);
  const visibleIds = useMemo(() => new Set(modelNodes.map((node) => node.id)), [modelNodes]);
  const modelEdges = useMemo<Edge[]>(() => focused.edges.flatMap((element) => {
    const source = typeof element.data.from === 'string' ? element.data.from : '';
    const target = typeof element.data.to === 'string' ? element.data.to : '';
    if (!visibleIds.has(source) || !visibleIds.has(target)) return [];
    const relationLabel = labelFor(element);
    const status = (typeof element.data.status === 'string' ? element.data.status : 'confirmed') as EdgeStatus;
    const statusStyle = edgeStatusStyle(status);
    const statusClass = EDGE_STATUS_CLASS[statusStyle.status];
    const composedLabel = statusStyle.labelPrefix
      ? `${statusStyle.labelPrefix} · ${relationLabel}`
      : relationLabel;
    return [{
      id: element.id,
      source,
      target,
      label: sheet.family === 'structure-overview' && composedLabel === '包含' ? undefined : composedLabel,
      type: sheet.family === 'relationship' ? 'default' : 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      className: `visual-flow-edge ${statusClass}`,
      style: { stroke: statusStyle.stroke, strokeDasharray: statusStyle.dash.join(' ') || undefined },
      labelStyle: { fontSize: 11, fill: statusStyle.stroke },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 2,
    }];
  }), [focused.edges, labelFor, sheet.family, visibleIds]);
  const [nodes, setNodes, onNodesChange] = useNodesState(modelNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(modelEdges);
  useEffect(() => setNodes(modelNodes), [modelNodes, setNodes]);
  useEffect(() => setEdges(modelEdges), [modelEdges, setEdges]);

  const selected = sheet.elements.find((element) => element.id === selectedId);
  return (
    <div className="visual-graph-shell">
      <div className="visual-graph" aria-label={`${sheet.name}画布`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          minZoom={expanded ? 0.2 : 0.55}
          maxZoom={1.6}
          fitView
          fitViewOptions={{ padding: 0.22, minZoom: expanded ? 0.2 : 0.55, maxZoom: 1.05 }}
          onInit={(instance) => { instanceRef.current = instance; }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onEdgeClick={(_, edge) => setSelectedId(edge.id)}
          onPaneClick={() => setSelectedId(null)}
          onNodeDragStop={(_, node) => onMoveNode(node.id, node.position.x, node.position.y)}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--visual-grid)" />
          <Controls showInteractive={false} position="bottom-left" />
          <Panel position="top-left" className="visual-graph-summary">
            <strong>{sheet.name}</strong>
            <span>{focused.nodes.length} 个节点 · {focused.edges.length} 条关系</span>
            {focused.hiddenNodeCount > 0 && (
              <button type="button" onClick={() => setExpanded(true)}>展开其余 {focused.hiddenNodeCount} 个</button>
            )}
            {expanded && sheet.elements.filter((element) => element.kind === 'node').length > 12 && (
              <button type="button" onClick={() => setExpanded(false)}>返回核心视图</button>
            )}
          </Panel>
          {selected && (
            <Panel position="top-right" className="visual-graph-inspector">
              <div><strong>{selected.kind === 'edge' ? '关系' : '原文依据'}</strong><button type="button" onClick={() => setSelectedId(null)}>关闭</button></div>
              {selected.kind === 'edge' && <EditableLabel element={selected} value={labelFor(selected)} onChange={onEditLabel} />}
              <p>{selected.anchor.excerpt}</p>
              {selected.kind === 'node' && <small>双击节点文字即可编辑展示名称</small>}
            </Panel>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}

export function TimelineRenderer({ sheet, labelFor, onEditLabel }: RendererProps) {
  return (
    <ol className="visual-timeline" aria-label="时间轴">
      {sheet.elements.filter((element) => element.kind === 'event').map((element, index) => (
        <li key={element.id}>
          <span className="visual-timeline-index">{String(index + 1).padStart(2, '0')}</span>
          <time>{String(element.data.date ?? '')}</time>
          <EditableLabel element={element} value={labelFor(element)} onChange={onEditLabel} />
          <span className="visual-source-badge" title={element.anchor.excerpt}>原文</span>
        </li>
      ))}
    </ol>
  );
}

export function MatrixRenderer({ sheet, labelFor, onEditLabel }: RendererProps) {
  const cells = sheet.elements.filter((element) => element.kind === 'matrix-cell');
  const columns = Math.max(0, ...cells.map((cell) => Number(cell.data.column) + 1));
  const rows = Math.max(0, ...cells.map((cell) => Number(cell.data.row) + 1));
  return (
    <div className="visual-matrix-wrap">
      <div className="visual-specialized-heading"><strong>{sheet.name}</strong><span>{Math.max(0, rows - 1)} 行 · {columns} 列</span></div>
      <table className="visual-matrix">
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (_, column) => {
                const cell = cells.find((candidate) => candidate.data.row === row && candidate.data.column === column);
                return <td key={column}>{cell ? <EditableLabel element={cell} value={labelFor(cell)} onChange={onEditLabel} /> : null}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartRenderer({ sheet, labelFor, onEditLabel }: RendererProps) {
  const points = sheet.elements.filter((element) => element.kind === 'chart-point');
  const values = points.map((point) => Number(point.data.value)).filter(Number.isFinite);
  const domainMin = Math.min(0, ...values);
  const domainMax = Math.max(0, ...values);
  const range = domainMax - domainMin || 1;
  const top = 25;
  const plotHeight = 230;
  const y = (value: number) => top + ((domainMax - value) / range) * plotHeight;
  const zero = y(0);
  const slot = points.length > 0 ? 640 / points.length : 640;
  return (
    <div className="visual-chart" aria-label="数值图表">
      <div className="visual-specialized-heading"><strong>{sheet.name}</strong><span>{points.length} 组数据</span></div>
      <svg viewBox="0 0 720 310" role="img" aria-label="柱状图">
        <line x1="40" y1={zero} x2="690" y2={zero} className="visual-chart-axis" />
        {points.map((point, index) => {
          const value = Number(point.data.value);
          const valueY = y(Number.isFinite(value) ? value : 0);
          return (
            <g key={point.id}>
              <rect x={50 + index * slot} y={Math.min(zero, valueY)} width={Math.max(18, slot - 22)} height={Math.max(1, Math.abs(zero - valueY))} rx="3" />
              <text x={50 + index * slot + Math.max(18, slot - 22) / 2} y={Math.min(zero, valueY) - 6} textAnchor="middle">{value}</text>
              <text x={50 + index * slot + Math.max(18, slot - 22) / 2} y="286" textAnchor="middle">{labelFor(point).slice(0, 12)}</text>
            </g>
          );
        })}
      </svg>
      <div className="visual-chart-editor">
        {points.map((point) => <EditableLabel key={point.id} element={point} value={labelFor(point)} onChange={onEditLabel} />)}
      </div>
    </div>
  );
}
