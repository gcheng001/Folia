/**
 * 自定义流程箭头：脱离父子关系，由用户拖拽产生。
 * 数据来自 canvas sidecar 的 customEdges 字段；本组件只负责渲染。
 */
import { memo } from 'react';
import { type EdgeProps, BaseEdge, getBezierPath, getSmoothStepPath } from '@xyflow/react';
import type { CustomFlowEdge as CustomFlowEdgeType } from '../../services/mindmap/canvasSidecar';

interface CustomFlowEdgeData {
  edge: CustomFlowEdgeType;
}

function arrowId(edgeId: string, color: string): string {
  return `arrow-${edgeId}-${color.replace(/[^a-z0-9]/gi, '')}`;
}

export const CustomFlowEdge = memo((props: EdgeProps) => {
  const { id, sourceX, sourceY, targetX, targetY, markerEnd, data } = props;
  const { edge } = (data as unknown as CustomFlowEdgeData) ?? { edge: null };
  if (!edge) return null;

  let path: string;
  if (edge.shape === 'step') {
    [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, borderRadius: 8 });
  } else {
    [path] = getBezierPath({ sourceX, sourceY, targetX, targetY });
  }

  const dasharray = edge.dash === 'dashed' ? '6 4' : undefined;
  const markerStart = edge.arrow === 'both' ? `url(#${arrowId(id, edge.color)}-start)` : undefined;
  const endMarker = edge.arrow === 'none' ? undefined : (markerEnd ?? `url(#${arrowId(id, edge.color)})`);

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={endMarker}
      markerStart={markerStart}
      style={{
        stroke: edge.color,
        strokeWidth: edge.width,
        strokeDasharray: dasharray,
        fill: 'none',
      }}
    />
  );
});

CustomFlowEdge.displayName = 'CustomFlowEdge';

export function edgeMarkerDefs(edge: CustomFlowEdgeType, id: string): React.ReactElement {
  const aId = arrowId(id, edge.color);
  const startId = `${aId}-start`;
  return (
    <>
      <defs>
        <marker
          id={aId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={edge.color} />
        </marker>
        <marker
          id={startId}
          viewBox="0 0 10 10"
          refX="1"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 10 0 L 0 5 L 10 10 z" fill={edge.color} />
        </marker>
      </defs>
    </>
  );
}
