/**
 * M-B 只读画布边（自澄脉 `CustomEdge.tsx` 原样移植，无编辑态改动）。
 * 贝塞尔曲线连接父子节点。
 */
import { memo } from 'react';
import { type EdgeProps, getBezierPath } from '@xyflow/react';

export const CustomEdge = memo(
  ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd }: EdgeProps) => {
    const [edgePath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    const edgeStyle: React.CSSProperties = {
      stroke: '#9ca3af',
      strokeWidth: 2,
      ...style,
    };

    return <path id={id} style={edgeStyle} className="react-flow__edge-path" d={edgePath} markerEnd={markerEnd} />;
  }
);

CustomEdge.displayName = 'CustomEdge';
