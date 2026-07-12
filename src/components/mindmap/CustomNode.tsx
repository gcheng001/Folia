/**
 * 经典树主题：黑色实心根节点 + 浅灰无边框圆角子节点，严格对应参考图。
 * 其余主题保留完整描边长方框。
 * 配色由主题（themes.ts）驱动；编辑态（M-C）渲染行内输入框，
 * Enter 提交 / Esc 取消，事件不冒泡到画布键盘处理器。
 */
import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { branchColor, getTheme, type MindMapTheme } from './themes';

interface CustomNodeData {
  label: string;
  kind: string;
  level: number;
  branchIndex: number;
  isRoot: boolean;
  theme?: MindMapTheme;
  editable?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  isConnectMode?: boolean;
  onStartEdit?: (nodeId: string) => void;
  onCommitEdit?: (lineIndex: number, text: string) => void;
  onCancelEdit?: (lineIndex: number) => void;
  /** P0-9: per-node 样式，包含颜色和尺寸覆盖 */
  perNodeStyle?: { color?: string; sizeLevel?: 'xs' | 's' | 'm' | 'l' | 'xl' };
  /** P1-1: 结构拖动目标状态 */
  isStructureTarget?: boolean;
  /** P1-1: 结构拖动确认状态（>=400ms） */
  isStructureConfirmed?: boolean;
  [key: string]: unknown;
}

function readableTextColor(hex: string): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : null;
  if (!normalized) return '#111827';
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#111827' : '#ffffff';
}

function connectHandleStyle(visible: boolean, side: 'left' | 'right'): CSSProperties {
  return visible
    ? {
        width: 14,
        height: 14,
        border: '2px solid #2563eb',
        background: '#ffffff',
        opacity: 1,
        boxShadow: '0 1px 4px rgba(37,99,235,0.35)',
        [side]: -7,
      }
    : { opacity: 0, width: 1, height: 1, border: 'none' };
}

const SIZE_SCALE = { xs: 0.78, s: 0.9, m: 1, l: 1.16, xl: 1.34 } as const;

export const CustomNode = memo(({ id, data }: NodeProps) => {
  const {
    label,
    branchIndex,
    isRoot,
    theme: maybeTheme,
    isSelected,
    isEditing,
    isConnectMode,
    editable,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    perNodeStyle,
    isStructureTarget,
    isStructureConfirmed,
  } = data as unknown as CustomNodeData;
  const theme = maybeTheme ?? getTheme(undefined);
  // P0-9: per-node 颜色优先于主题分支颜色
  const customColor = perNodeStyle?.color;
  const color = customColor ?? branchColor(theme, branchIndex ?? -1);
  const sizeScale = SIZE_SCALE[perNodeStyle?.sizeLevel ?? 'm'];
  const lineIndex = Number(id.slice(1));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (!isEditing) return;
    const focusInput = (): void => {
      const input = inputRef.current;
      if (!input) return;
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      input.select();
    };
    // autoFocus 在 WKWebView + React Flow 测量重渲染时会被画布容器抢回。
    // 覆盖挂载、下一帧和节点测量的短周期，直到画布布局稳定。
    focusInput();
    const frame = requestAnimationFrame(focusInput);
    const timers = [0, 50, 150].map((delay) => window.setTimeout(focusInput, delay));
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isEditing]);

  const classic = theme.nodeVariant === 'classic';
  const baseFontSize = isRoot ? 16 : 14;
  const nodeStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: isRoot
      ? `${Math.round(11 * sizeScale)}px ${Math.round(20 * sizeScale)}px`
      : `${Math.round(9 * sizeScale)}px ${Math.round(16 * sizeScale)}px`,
    border: classic ? 'none' : `${isRoot ? 2 : 1.5}px solid ${isRoot ? theme.root : color}`,
    borderRadius: classic ? (isRoot ? '16px' : '12px') : '2px',
    backgroundColor: classic
      ? (isRoot ? 'var(--text, #050505)' : 'color-mix(in srgb, var(--text, #171717) 8%, var(--surface, #ffffff))')
      : 'var(--surface, #fff)',
    color: classic && isRoot ? 'var(--surface, #ffffff)' : (isRoot ? theme.root : theme.text),
    fontSize: `${Math.max(11, Math.round(baseFontSize * Math.min(sizeScale, 1.22)))}px`,
    fontWeight: isRoot ? 600 : 400,
    fontFamily: 'var(--font-body)',
    minWidth: `${Math.round((isRoot ? 120 : 96) * sizeScale)}px`,
    maxWidth: `${Math.round(340 * Math.max(1, sizeScale))}px`,
    textAlign: 'center',
  };

  if (customColor) {
    nodeStyle.backgroundColor = customColor;
    nodeStyle.border = `${isRoot ? 2 : 1.5}px solid ${customColor}`;
    nodeStyle.color = readableTextColor(customColor);
  }

  // P1-1: 结构拖动高亮：确认前后不同样式
  if (isStructureConfirmed) {
    // 确认状态（>=400ms）：明显高亮 + 绿色调
    nodeStyle.boxShadow = `0 0 0 3px #22c55e, 0 0 0 5px #22c55e33`;
    nodeStyle.border = classic ? 'none' : `3px solid #22c55e`;
  } else if (isStructureTarget) {
    // 预告状态（<400ms）：轻微高亮
    nodeStyle.boxShadow = `0 0 0 2px ${color}88, 0 0 0 4px ${color}44`;
  } else if (isSelected && !isEditing) {
    nodeStyle.boxShadow = `0 0 0 2px #ffffff, 0 0 0 5px #2563eb, 0 8px 20px rgba(37,99,235,0.24)`;
    nodeStyle.outline = '2px solid #1d4ed8';
    nodeStyle.outlineOffset = 2;
  }

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={connectHandleStyle(!!isConnectMode, 'left')}
      />
      <div
        data-mindmap-node="true"
        data-mindmap-selected={isSelected && !isEditing ? 'true' : undefined}
        data-mindmap-node-color={customColor ?? undefined}
        className="nowheel nopan"
        style={{ ...nodeStyle, cursor: isEditing ? 'text' : (editable ? 'grab' : 'default') }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStartEdit?.(id);
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            className="nodrag nowheel nopan"
            autoFocus
            defaultValue={label}
            aria-label="编辑节点文字"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                onCommitEdit?.(lineIndex, e.currentTarget.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelEdit?.(lineIndex);
              } else if (e.key === 'Tab') {
                // 输入态不做层级操作，也不让浏览器移动焦点
                e.preventDefault();
              }
            }}
            onBlur={(e) => onCommitEdit?.(lineIndex, e.currentTarget.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              font: 'inherit',
              color: 'inherit',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              width: `${Math.max(6, label.length + 2)}em`,
              maxWidth: '280px',
            }}
          />
        ) : (
          <span>{label || '(未命名)'}</span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={connectHandleStyle(!!isConnectMode, 'right')}
      />
    </>
  );
});

CustomNode.displayName = 'CustomNode';
