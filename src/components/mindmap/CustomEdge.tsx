/**
 * 脑图画布边：父子节点之间使用单段直线，不做曲线或圆角折线，
 * 颜色/线宽由 MindMapPane 按分支主题经 style 注入。
 */
import { memo } from 'react';
import { type EdgeProps, getStraightPath } from '@xyflow/react';

export const CustomEdge = memo(
  ({ id, sourceX, sourceY, targetX, targetY, style = {}, markerEnd }: EdgeProps) => {
    const [edgePath] = getStraightPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
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
