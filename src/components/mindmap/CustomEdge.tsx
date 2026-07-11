/**
 * M-B 只读画布边。简洁直线条形态（PRD 项 B）：圆角折线（smoothstep），
 * 颜色/线宽由 MindMapPane 按分支主题经 style 注入。
 */
import { memo } from 'react';
import { type EdgeProps, getSmoothStepPath } from '@xyflow/react';

export const CustomEdge = memo(
  ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd }: EdgeProps) => {
    const [edgePath] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      borderRadius: 10,
    });

    const edgeStyle: React.CSSProperties = {
      stroke: '#9ca3af',
      strokeWidth: 1.5,
      fill: 'none',
      ...style,
    };

    return <path id={id} style={edgeStyle} className="react-flow__edge-path" d={edgePath} markerEnd={markerEnd} />;
  }
);

CustomEdge.displayName = 'CustomEdge';
