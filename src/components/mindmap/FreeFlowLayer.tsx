import { ViewportPortal } from '@xyflow/react';
import type { FreeFlowLine } from '../../services/mindmap/canvasSidecar';
import { resolveEndpoint, type FlowPoint, type FreeLineNodeBox } from '../../services/mindmap/freeFlow';

interface FreeFlowLayerProps {
  lines: FreeFlowLine[];
  nodes: FreeLineNodeBox[];
  selectedIds: string[];
  draft?: { start: FlowPoint; end: FlowPoint; arrow: FreeFlowLine['arrow'] } | null;
  onSelect: (id: string, additive: boolean) => void;
}

function markerId(line: Pick<FreeFlowLine, 'id' | 'color'>, suffix = ''): string {
  return `free-line-${line.id}-${line.color.replace(/[^a-z0-9]/gi, '')}${suffix}`;
}

function linePath(start: FlowPoint, end: FlowPoint): string {
  return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
}

export function FreeFlowLayer({ lines, nodes, selectedIds, draft, onSelect }: FreeFlowLayerProps): React.ReactElement {
  return (
    <ViewportPortal>
      <svg
        data-testid="mm-free-flow-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      >
        <defs>
          {lines.map((line) => (
            <g key={line.id}>
              <marker id={markerId(line)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={line.color} />
              </marker>
              <marker id={markerId(line, '-start')} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 10 0 L 0 5 L 10 10 z" fill={line.color} />
              </marker>
            </g>
          ))}
        </defs>
        {lines.map((line) => {
          const start = resolveEndpoint(line.start, nodes);
          const end = resolveEndpoint(line.end, nodes);
          const selected = selectedIds.includes(line.id);
          const path = linePath(start, end);
          return (
            <g key={line.id} data-testid={`mm-free-line-${line.id}`}>
              {selected && (
                <path
                  d={path}
                  className="mindmap-selection-ring"
                  stroke="#2563eb"
                  strokeWidth={Math.max(line.width + 8, 9)}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.2}
                  pointerEvents="none"
                />
              )}
              <path
                d={path}
                className="mindmap-free-flow-line"
                stroke={line.color}
                strokeWidth={line.width}
                strokeDasharray={line.dash === 'dashed' ? '6 4' : undefined}
                strokeLinecap="round"
                markerStart={line.arrow === 'both' ? `url(#${markerId(line, '-start')})` : undefined}
                markerEnd={line.arrow === 'none' ? undefined : `url(#${markerId(line)})`}
                fill="none"
                pointerEvents="visibleStroke"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(line.id, event.shiftKey);
                }}
                style={{ cursor: 'pointer' }}
              />
              {selected && (
                <>
                  <circle cx={start.x} cy={start.y} r={4} fill="#ffffff" stroke="#2563eb" strokeWidth={1.5} pointerEvents="none" />
                  <circle cx={end.x} cy={end.y} r={4} fill="#ffffff" stroke="#2563eb" strokeWidth={1.5} pointerEvents="none" />
                </>
              )}
            </g>
          );
        })}
        {draft && (
          <path
            d={linePath(draft.start, draft.end)}
            data-testid="mm-free-line-draft"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
            markerEnd={draft.arrow === 'none' ? undefined : 'url(#mm-free-line-draft-arrow)'}
            fill="none"
            pointerEvents="none"
          />
        )}
        <defs>
          <marker id="mm-free-line-draft-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
          </marker>
        </defs>
      </svg>
    </ViewportPortal>
  );
}
