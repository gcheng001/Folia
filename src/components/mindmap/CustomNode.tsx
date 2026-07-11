/**
 * 脑图画布节点。简洁直线条形态（PRD 项 B）：
 * 所有节点统一为小圆角长方形完整边框，根节点仅通过线宽和字重强调。
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

  const nodeStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    padding: isRoot ? '9px 16px' : '7px 14px',
    border: `${isRoot ? 2 : 1.5}px solid ${isRoot ? theme.root : color}`,
    borderRadius: '2px',
    backgroundColor: 'var(--surface, #fff)',
    color: isRoot ? theme.root : theme.text,
    fontSize: isRoot ? '15px' : '14px',
    fontWeight: isRoot ? 600 : 400,
    fontFamily: 'var(--font-body)',
    minWidth: '80px',
    maxWidth: '320px',
    textAlign: 'center',
  };

  if (isSelected && !isEditing) {
    nodeStyle.boxShadow = `0 0 0 2px ${color}55, 0 0 0 4px ${color}22`;
  }

  return (
    <>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div
        className="nodrag nowheel nopan"
        style={{ ...nodeStyle, cursor: onStartEdit ? 'text' : 'default' }}
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
