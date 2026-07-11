/**
 * 经典树主题：黑色实心根节点 + 浅灰无边框圆角子节点，严格对应参考图。
 * 其余主题保留完整描边长方框。
 * 配色由主题（themes.ts）驱动；编辑态（M-C）渲染行内输入框，
 * Enter 提交 / Esc 取消，事件不冒泡到画布键盘处理器。
 */
import { memo, useLayoutEffect, useRef } from 'react';
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
  onStartEdit?: (nodeId: string) => void;
  onCommitEdit?: (lineIndex: number, text: string) => void;
  onCancelEdit?: (lineIndex: number) => void;
  [key: string]: unknown;
}

const handleStyle: React.CSSProperties = { opacity: 0, width: 1, height: 1, border: 'none' };

export const CustomNode = memo(({ id, data }: NodeProps) => {
  const {
    label,
    branchIndex,
    isRoot,
    theme: maybeTheme,
    isSelected,
    isEditing,
    editable,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
  } = data as unknown as CustomNodeData;
  const theme = maybeTheme ?? getTheme(undefined);
  const color = branchColor(theme, branchIndex ?? -1);
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
  const nodeStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: isRoot ? '11px 20px' : '9px 16px',
    border: classic ? 'none' : `${isRoot ? 2 : 1.5}px solid ${isRoot ? theme.root : color}`,
    borderRadius: classic ? (isRoot ? '16px' : '12px') : '2px',
    backgroundColor: classic
      ? (isRoot ? 'var(--text, #050505)' : 'color-mix(in srgb, var(--text, #171717) 8%, var(--surface, #ffffff))')
      : 'var(--surface, #fff)',
    color: classic && isRoot ? 'var(--surface, #ffffff)' : (isRoot ? theme.root : theme.text),
    fontSize: isRoot ? '16px' : '14px',
    fontWeight: isRoot ? 600 : 400,
    fontFamily: 'var(--font-body)',
    minWidth: isRoot ? '120px' : '96px',
    maxWidth: '340px',
    textAlign: 'center',
  };

  if (isSelected && !isEditing) {
    nodeStyle.boxShadow = `0 0 0 2px ${color}55, 0 0 0 4px ${color}22`;
  }

  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div
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
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </>
  );
});

CustomNode.displayName = 'CustomNode';
