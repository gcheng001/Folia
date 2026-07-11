/**
 * 标注框节点：画在所选节点之下层，不参与连接、不接收 hover。
 * 包围盒由父组件按成员节点的实时位置重新计算，节点移动/框拖动都
 * 走统一的 positions / groups 状态。
 */
import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import type { AnnotationGroup, AnnotationStyle } from '../../services/mindmap/canvasSidecar';

export interface GroupNodeData {
  group: AnnotationGroup;
  /** 实时包围盒 { x, y, width, height }，由父组件按成员坐标算。 */
  bbox: { x: number; y: number; width: number; height: number };
  isSelected: boolean;
  [key: string]: unknown;
}

const PADDING = 18;
const TITLE_HEIGHT = 24;

function styleToCss(style: AnnotationStyle): React.CSSProperties {
  return {
    border: `${style.width}px ${style.borderStyle === 'dashed' ? 'dashed' : 'solid'} ${style.color}`,
    borderRadius: style.corner === 'rounded' ? 10 : 0,
    background: style.fill === 'light' ? `${style.color}11` : 'transparent',
    pointerEvents: 'none',
  };
}

export const AnnotationGroupNode = memo(({ data }: NodeProps) => {
  const { group, bbox, isSelected } = data as unknown as GroupNodeData;
  const showTitle = group.title.trim() !== '';
  return (
    <div
      className="nowheel nopan"
      style={{
        position: 'absolute',
        left: bbox.x,
        top: bbox.y,
        width: bbox.width,
        height: bbox.height,
        ...styleToCss(group.style),
        zIndex: -1,
      }}
    >
      {showTitle && (
        <div
          style={{
            position: 'absolute',
            top: -TITLE_HEIGHT,
            left: 0,
            fontSize: 12,
            fontWeight: 500,
            color: group.style.color,
            background: 'var(--surface, #fff)',
            padding: '0 6px',
            lineHeight: `${TITLE_HEIGHT}px`,
            borderRadius: 4,
            pointerEvents: 'auto',
          }}
        >
          {group.title}
        </div>
      )}
      {isSelected && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            border: '1.5px solid var(--accent, #3b82f6)',
            borderRadius: group.style.corner === 'rounded' ? 12 : 0,
            pointerEvents: 'none',
          }}
        />
      )}
      {/* 让父级能拿到节点尺寸，PADDING 不算进 bbox */}
      {/* bbox 已含 padding，宽度对齐成员外包络 + 2*PADDING */}
      {PADDING /* 标注：无渲染用途，仅供注释 */}
    </div>
  );
});

AnnotationGroupNode.displayName = 'AnnotationGroupNode';

export function makeGroupNode(group: AnnotationGroup, bbox: { x: number; y: number; width: number; height: number }, isSelected: boolean): Node {
  return {
    id: `g:${group.id}`,
    type: 'annotation',
    position: { x: bbox.x, y: bbox.y },
    data: { group, bbox, isSelected },
    draggable: true,
    selectable: true,
    zIndex: -1,
  };
}

export function computeGroupBbox(
  members: Array<{ x: number; y: number; width: number; height: number } | undefined>,
): { x: number; y: number; width: number; height: number } | null {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  let count = 0;
  for (const m of members) {
    if (!m) continue;
    count++;
    if (m.x < left) left = m.x;
    if (m.x + m.width > right) right = m.x + m.width;
    if (m.y < top) top = m.y;
    if (m.y + m.height > bottom) bottom = m.y + m.height;
  }
  if (count === 0) return null;
  return {
    x: left - PADDING,
    y: top - PADDING - (TITLE_HEIGHT / 2),
    width: right - left + PADDING * 2,
    height: bottom - top + PADDING * 2 + (TITLE_HEIGHT / 2),
  };
}

export const GROUP_PADDING = PADDING;
