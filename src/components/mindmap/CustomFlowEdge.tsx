/**
 * 自定义流程箭头：脱离父子关系，由用户拖拽产生。
 * 数据来自 canvas sidecar 的 customEdges 字段；本组件只负责渲染。
 */
/**
 * 自定义流程箭头：脱离父子关系，由用户拖拽产生。
 * 数据来自 canvas sidecar 的 customEdges 字段；本组件只负责渲染。
 *
 * shape:
 *   - straight → getStraightPath（直线，不被误判为贝塞尔）
 *   - step     → getSmoothStepPath（折线，圆角拐弯）
 *
 * marker：每条边生成稳定 ID（arrow-{edgeId}-{hashColor}），颜色与父边一致；
 *   父组件必须把本边所需 marker 一并挂到 React Flow 的 SVG <defs>。
 */
import { memo } from 'react';
import { type EdgeProps, BaseEdge, getStraightPath, getSmoothStepPath } from '@xyflow/react';
import type { CustomFlowEdge as CustomFlowEdgeType } from '../../services/mindmap/canvasSidecar';

interface CustomFlowEdgeData {
  edge: CustomFlowEdgeType;
}

/** 用规则字符把颜色 hash 成可作 id 的 ASCII（去 # 等）。 */
function arrowId(edgeId: string, color: string): string {
  return `arrow-${edgeId}-${color.replace(/[^a-z0-9]/gi, '')}`;
}

/** React Flow 内部也可能用 -1 这种 emoji，需要 fallback。 */
function safeEdgeId(id: string | undefined): string {
  if (!id || typeof id !== 'string') return 'cf';
  return id;
}

export const CustomFlowEdge = memo((props: EdgeProps) => {
  const { id, sourceX, sourceY, targetX, targetY, data } = props;
  const { edge } = (data as unknown as CustomFlowEdgeData) ?? { edge: null };
  if (!edge) return null;

  let path: string;
  if (edge.shape === 'step') {
    [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, borderRadius: 8 });
  } else {
    // P0-8：straight 必须是直线。
    [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  }

  const dasharray = edge.dash === 'dashed' ? '6 4' : undefined;
  const endId = `url(#${arrowId(id, edge.color)})`;
  const startId = `url(#${arrowId(id, edge.color)}-start)`;
  const markerStart = edge.arrow === 'both' ? startId : undefined;
  const markerEnd = edge.arrow === 'none' ? undefined : endId;

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
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

interface EdgeMarkerDefsProps {
  edge: CustomFlowEdgeType;
  id: string;
}

/**
 * 生成当前 custom edge 所需的 SVG <marker> defs。父组件把所有边都跑一遍
 * 这个函数，把结果挂到 React Flow 的顶层 SVG <defs>。否则 markerEnd=
 * 引用了未定义的 id，箭头不会显示。
 *
 * 返回单个 <g> 包裹的 marker 数组，便于在 <defs> 内直接展开。
 * 组件名用 PascalCase（<EdgeMarkerDefs>），React 才能识别为组件；
 * camelCase 形式的标签会被当成自定义 HTML 元素，原样渲染到 DOM。
 */
export function EdgeMarkerDefs(props: EdgeMarkerDefsProps): React.ReactElement {
  const { edge, id } = props;
  const aId = arrowId(safeEdgeId(id), edge.color);
  const startId = `${aId}-start`;
  return (
    <g aria-hidden style={{ display: 'none' }} data-edge-markers={aId}>
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
    </g>
  );
}

