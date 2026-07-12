import { Background, BackgroundVariant, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TraceableElement, VisualSheet } from '../../services/visualization/types';

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

export function GraphRenderer({ sheet, labelFor, onEditLabel, onMoveNode }: RendererProps) {
  const formalNodes = sheet.elements.filter((element) => element.kind === 'node');
  const nodes: Node[] = formalNodes.map((element, index) => {
    const saved = sheet.layout[element.id] ?? {};
    const x = typeof saved.x === 'number' ? saved.x : 60 + (index % 3) * 250;
    const y = typeof saved.y === 'number' ? saved.y : 50 + Math.floor(index / 3) * 130;
    return {
      id: element.id,
      position: { x, y },
      data: { label: <EditableLabel element={element} value={labelFor(element)} onChange={onEditLabel} /> },
      className: `visual-flow-node visual-flow-node--${String(element.data.flowKind ?? 'default')}`,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const formalEdges = sheet.elements.filter((element) => element.kind === 'edge');
  const edges: Edge[] = formalEdges
    .flatMap((element) => {
      const from = typeof element.data.from === 'string' ? element.data.from : '';
      const to = typeof element.data.to === 'string' ? element.data.to : '';
      if (!nodeIds.has(from) || !nodeIds.has(to)) return [];
      return [{ id: element.id, source: from, target: to, label: labelFor(element), animated: false }];
    });
  return (
    <div className="visual-graph-shell">
      <div className="visual-graph" aria-label={`${sheet.name}画布`}>
        <ReactFlow
          key={`${sheet.id}-${sheet.updatedAt}`}
          defaultNodes={nodes}
          defaultEdges={edges}
          fitView
          minZoom={0.25}
          maxZoom={2}
          onNodeDragStop={(_, node) => onMoveNode(node.id, node.position.x, node.position.y)}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d8d3ca" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {formalEdges.length > 0 && (
        <div className="visual-edge-editor" aria-label="连接文字">
          {formalEdges.map((element) => (
            <EditableLabel key={element.id} element={element} value={labelFor(element)} onChange={onEditLabel} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TimelineRenderer({ sheet, labelFor, onEditLabel }: RendererProps) {
  return (
    <ol className="visual-timeline" aria-label="时间轴">
      {sheet.elements.filter((element) => element.kind === 'event').map((element) => (
        <li key={element.id}>
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
      <svg viewBox="0 0 720 310" role="img" aria-label="柱状图">
        <line x1="40" y1={zero} x2="690" y2={zero} className="visual-chart-axis" />
        {points.map((point, index) => {
          const value = Number(point.data.value);
          const valueY = y(Number.isFinite(value) ? value : 0);
          return (
            <g key={point.id}>
              <rect x={50 + index * slot} y={Math.min(zero, valueY)} width={Math.max(18, slot - 22)} height={Math.max(1, Math.abs(zero - valueY))} />
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
