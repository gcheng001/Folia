/**
 * 经典树边使用参考图同款「水平主干 + 共享竖干 + 圆角直角支路」。同一父节点
 * 的多条边采用相同 junctionX，重叠部分视觉上合并为一根共享分叉干线。
 * 其他主题继续使用单段直线。
 */
import { memo } from 'react';
import { type EdgeProps, getStraightPath } from '@xyflow/react';

export const CustomEdge = memo(
  ({ id, sourceX, sourceY, targetX, targetY, data, style = {}, markerEnd }: EdgeProps) => {
    const variant = (data as { edgeVariant?: string } | undefined)?.edgeVariant;
    let edgePath: string;
    if (variant === 'classic-branch') {
      if (sourceY === targetY) {
        edgePath = `M ${sourceX},${sourceY}H ${targetX}`;
      } else {
        const deltaX = targetX - sourceX;
        const directionX = deltaX >= 0 ? 1 : -1;
        const junctionX = sourceX + deltaX * 0.44;
        const radius = Math.min(12, Math.abs(targetY - sourceY) / 2, Math.abs(targetX - junctionX) / 2);
        const verticalEnd = targetY > sourceY ? targetY - radius : targetY + radius;
        const elbowEndX = junctionX + directionX * radius;
        edgePath = `M ${sourceX},${sourceY}H ${junctionX}V ${verticalEnd}Q ${junctionX},${targetY} ${elbowEndX},${targetY}H ${targetX}`;
      }
    } else {
      [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
    }

    const edgeStyle: React.CSSProperties = {
      stroke: '#9ca3af',
      strokeWidth: 1.5,
      fill: 'none',
      ...style,
    };

    return (
      <path
        id={id}
        style={edgeStyle}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
);

CustomEdge.displayName = 'CustomEdge';
