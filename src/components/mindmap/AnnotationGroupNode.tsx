/**
 * 标注框节点：画在所选节点之下层，不参与连接、不接收 hover。
 * 包围盒由父组件按成员节点的实时位置重新计算，节点移动/框拖动都
 * 走统一的 positions / groups 状态。
 */
import { memo, useState, useRef, useEffect } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import type { AnnotationGroup, AnnotationStyle } from '../../services/mindmap/canvasSidecar';

export interface GroupNodeData {
  group: AnnotationGroup;
  /** 实时包围盒 { x, y, width, number; height: number }，由父组件按成员坐标算。 */
  bbox: { x: number; y: number; width: number; height: number };
  isSelected: boolean;
  /** P0-6: 标题编辑回调 */
  onTitleChange?: (newTitle: string) => void;
  [key: string]: unknown;
}

const PADDING = 18;
const TITLE_HEIGHT = 24;

function styleToCss(style: AnnotationStyle): React.CSSProperties {
  return {
    border: `${style.width}px ${style.borderStyle === 'dashed' ? 'dashed' : 'solid'} ${style.color}`,
    borderRadius: style.corner === 'rounded' ? 10 : 0,
    background: style.fill === 'light' ? `${style.color}11` : 'transparent',
  };
}

export const AnnotationGroupNode = memo(({ data }: NodeProps) => {
  const { group, bbox, isSelected, onTitleChange } = data as unknown as GroupNodeData;
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(group.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const showTitle = group.title.trim() !== '';

  // P0-6: 双击标题进入编辑态
  const handleDoubleClick = () => {
    if (!onTitleChange) return;
    setIsEditing(true);
    setEditText(group.title);
  };

  // P0-6: Enter 保存，Esc 取消
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onTitleChange) return;
    if (e.key === 'Enter') {
      onTitleChange(editText.trim());
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditText(group.title);
    }
  };

  // P0-6: blur 时保存
  const handleBlur = () => {
    if (!onTitleChange) return;
    onTitleChange(editText.trim());
    setIsEditing(false);
  };

  // P0-6: 编辑态时自动 focus input
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  return (
    <div
      data-mindmap-selected={isSelected ? 'true' : undefined}
      className="nowheel nopan"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: bbox.width,
        height: bbox.height,
        ...styleToCss(group.style),
        zIndex: -1,
        pointerEvents: 'auto',
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
            cursor: onTitleChange ? 'text' : 'default',
          }}
          onDoubleClick={handleDoubleClick}
        >
          {isEditing && onTitleChange ? (
            <input
              ref={inputRef}
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: group.style.color,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                padding: '0 2px',
                width: Math.max(60, group.title.length * 8),
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>{group.title}</>
          )}
        </div>
      )}
      {isSelected && (
        <div
          style={{
            position: 'absolute',
            inset: -3,
            border: '2px solid #2563eb',
            borderRadius: group.style.corner === 'rounded' ? 12 : 0,
            boxShadow: '0 0 0 2px #ffffff, 0 8px 20px rgba(37,99,235,0.2)',
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

export function makeGroupNode(
  group: AnnotationGroup,
  bbox: { x: number; y: number; width: number; height: number },
  isSelected: boolean,
  onTitleChange?: (newTitle: string) => void,
): Node {
  return {
    id: `g:${group.id}`,
    type: 'annotation',
    position: { x: bbox.x, y: bbox.y },
    // P0-4: Node 顶层明确 width/height，确保 React Flow 知道节点尺寸
    width: bbox.width,
    height: bbox.height,
    style: { width: bbox.width, height: bbox.height }, // P0-4: 明确 style
    data: { group, bbox, isSelected, onTitleChange },
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
