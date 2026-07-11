/**
 * 脑图工具栏：紧凑 8 按钮 + 主题切换。悬浮在画布右上，与上下文样式栏
 * 分工（颜色/线型等高频项放上下文栏，避免主工具栏臃肿）。
 */
import { useEffect, useRef, useState } from 'react';
import { MINDMAP_THEMES, type MindMapThemeId } from './themes';
import type { EdgeDisplayMode } from '../../services/mindmap/canvasSidecar';

export type MindMapTool =
  | 'select'
  | 'connect'
  | 'auto-layout'
  | 'align'
  | 'edge-mode'
  | 'group'
  | 'undo'
  | 'export';

interface MindMapToolbarProps {
  themeId: MindMapThemeId;
  onThemeChange: (id: MindMapThemeId) => void;
  activeTool: MindMapTool;
  onToolChange: (tool: MindMapTool) => void;
  edgeMode: EdgeDisplayMode;
  onEdgeModeChange: (mode: EdgeDisplayMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onAutoLayout: () => void;
  onUndo: () => void;
  onRedo: () => void;
  // P1-5: 导出参数包含format, scale, background
  onExport: (format: 'png' | 'pdf', scale?: number, background?: 'transparent' | 'white') => void;
  selectedCount: number;
  onCreateGroup: () => void;
  onAlign: (kind: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom' | 'distribute-h' | 'distribute-v') => void;
  onToggleThemePanel: () => void;
  showThemePanel: boolean;
}

interface ButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
  badge?: number;
  testId?: string;
}

function ToolButton({ label, active, disabled, onClick, children, badge, testId }: ButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        border: '1px solid transparent',
        cursor: disabled ? 'default' : 'pointer',
        background: active ? 'var(--accent, #3b82f6)' : 'transparent',
        color: active ? 'var(--surface, #fff)' : 'var(--text, #1f2937)',
        opacity: disabled ? 0.4 : 1,
        position: 'relative',
      }}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: 'var(--accent, #3b82f6)',
            color: 'var(--surface, #fff)',
            fontSize: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

const EDGE_MODES: { id: EdgeDisplayMode; label: string }[] = [
  { id: 'mindmap', label: '脑图线' },
  { id: 'flow', label: '流程箭头' },
  { id: 'none', label: '无连接线' },
];

export function MindMapToolbar(props: MindMapToolbarProps): React.ReactElement {
  const {
    themeId, onThemeChange,
    activeTool, onToolChange,
    edgeMode, onEdgeModeChange,
    canUndo, canRedo,
    onAutoLayout, onUndo, onRedo,
    onExport, selectedCount, onCreateGroup,
    onAlign, onToggleThemePanel, showThemePanel,
  } = props;
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [alignOpen, setAlignOpen] = useState(false);
  const alignRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (exportOpen && exportRef.current && !exportRef.current.contains(target)) {
        setExportOpen(false);
      }
      if (alignOpen && alignRef.current && !alignRef.current.contains(target)) {
        setAlignOpen(false);
      }
    }
    if (exportOpen || alignOpen) {
      window.addEventListener('mousedown', closeOnOutside);
      return () => window.removeEventListener('mousedown', closeOnOutside);
    }
    return undefined;
  }, [exportOpen, alignOpen]);

  const wrapperStyle: React.CSSProperties = {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 6,
    borderRadius: 10,
    background: 'var(--surface, #fff)',
    border: '1px solid var(--border, #e5e7eb)',
    boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
  };

  const alignButtonDisabled = selectedCount < 2;
  const groupButtonDisabled = selectedCount < 2;
  const distributeDisabled = selectedCount < 3;

  return (
    <div style={wrapperStyle} role="toolbar" aria-label="脑图工具栏">
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <ToolButton
          label="选择"
          active={activeTool === 'select'}
          onClick={() => onToolChange('select')}
          testId="mm-tool-select"
        >
          {/* cursor arrow */}
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 2 L13 8 L8 9 L7 14 Z" fill="currentColor" />
          </svg>
        </ToolButton>
        <ToolButton
          label="连接模式（Esc 退出）"
          active={activeTool === 'connect'}
          onClick={() => onToolChange(activeTool === 'connect' ? 'select' : 'connect')}
          testId="mm-tool-connect"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <circle cx="3" cy="8" r="2" fill="currentColor" />
            <circle cx="13" cy="8" r="2" fill="currentColor" />
            <path d="M5 8 H 11" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </ToolButton>
        <ToolButton
          label="自动布局"
          onClick={onAutoLayout}
          testId="mm-tool-auto-layout"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <rect x="1" y="1" width="6" height="6" stroke="currentColor" fill="none" />
            <rect x="9" y="1" width="6" height="6" stroke="currentColor" fill="none" />
            <rect x="1" y="9" width="6" height="6" stroke="currentColor" fill="none" />
            <rect x="9" y="9" width="6" height="6" stroke="currentColor" fill="none" />
          </svg>
        </ToolButton>
        <div ref={alignRef} style={{ position: 'relative' }}>
          <ToolButton
            label="对齐/等间距"
            disabled={alignButtonDisabled}
            active={alignOpen}
            onClick={() => setAlignOpen((v) => !v)}
            testId="mm-tool-align"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="2" y="2" width="12" height="2" fill="currentColor" />
              <rect x="2" y="6" width="8" height="2" fill="currentColor" />
              <rect x="2" y="10" width="4" height="2" fill="currentColor" />
              <rect x="2" y="14" width="12" height="2" fill="currentColor" />
            </svg>
          </ToolButton>
          {alignOpen && (
            <div
              role="menu"
              data-testid="mm-align-menu"
              style={{
                position: 'absolute',
                top: 36,
                right: 0,
                background: 'var(--surface, #fff)',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                padding: 4,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 32px)',
                gap: 2,
                zIndex: 11,
              }}
            >
              {(
                [
                  ['left', '左对齐', <path key="l" d="M2 1 H14 M2 7 H10 M2 13 H6" stroke="currentColor" fill="none" />],
                  ['center-h', '水平居中', <path key="ch" d="M2 1 H14 M4 7 H10 M7 13" stroke="currentColor" fill="none" />],
                  ['right', '右对齐', <path key="r" d="M2 1 H14 M6 7 H14 M10 13" stroke="currentColor" fill="none" />],
                  ['top', '顶部对齐', <path key="t" d="M1 2 H6 M9 2 H14 M1 6 H10 M1 10 H14" stroke="currentColor" fill="none" />],
                  ['center-v', '垂直居中', <path key="cv" d="M1 2 H6 M1 6 H10 M1 10 H14" stroke="currentColor" fill="none" />],
                  ['bottom', '底部对齐', <path key="b" d="M1 6 H6 M9 6 H14 M1 10 H10 M1 14 H14" stroke="currentColor" fill="none" />],
                ] as const
              ).map(([kind, label, icon]) => (
                <button
                  key={kind}
                  type="button"
                  title={label}
                  aria-label={label}
                  data-testid={`mm-align-${kind}`}
                  onClick={() => {
                    onAlign(kind);
                    setAlignOpen(false);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text, #1f2937)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                    {icon}
                  </svg>
                </button>
              ))}
              <button
                type="button"
                title="水平等间距"
                aria-label="水平等间距"
                disabled={distributeDisabled}
                data-testid="mm-align-distribute-h"
                onClick={() => { onAlign('distribute-h'); setAlignOpen(false); }}
                style={iconButtonStyle(distributeDisabled)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <rect x="1" y="4" width="2" height="8" fill="currentColor" />
                  <rect x="7" y="4" width="2" height="8" fill="currentColor" />
                  <rect x="13" y="4" width="2" height="8" fill="currentColor" />
                  <path d="M3 8 H7 M9 8 H13" stroke="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                title="垂直等间距"
                aria-label="垂直等间距"
                disabled={distributeDisabled}
                data-testid="mm-align-distribute-v"
                onClick={() => { onAlign('distribute-v'); setAlignOpen(false); }}
                style={iconButtonStyle(distributeDisabled)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <rect x="4" y="1" width="8" height="2" fill="currentColor" />
                  <rect x="4" y="7" width="8" height="2" fill="currentColor" />
                  <rect x="4" y="13" width="8" height="2" fill="currentColor" />
                  <path d="M8 3 V7 M8 9 V13" stroke="currentColor" />
                </svg>
              </button>
              <div />
            </div>
          )}
        </div>
        <ToolButton
          label="添加标注框"
          disabled={groupButtonDisabled}
          onClick={onCreateGroup}
          testId="mm-tool-group"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <rect x="1.5" y="1.5" width="13" height="13" stroke="currentColor" strokeDasharray="3 2" fill="none" />
          </svg>
        </ToolButton>
        <div ref={exportRef} style={{ position: 'relative' }}>
          <ToolButton
            label="导出 PNG / PDF"
            active={exportOpen}
            onClick={() => setExportOpen((v) => !v)}
            testId="mm-tool-export"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <path d="M8 1 V 11 M4 7 L 8 11 L 12 7" stroke="currentColor" fill="none" />
              <path d="M2 13 H 14" stroke="currentColor" />
            </svg>
          </ToolButton>
          {exportOpen && (
            <div
              role="menu"
              data-testid="mm-export-menu"
              style={{
                position: 'absolute',
                top: 36,
                right: 0,
                background: 'var(--surface, #fff)',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                padding: 4,
                zIndex: 11,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 200,
              }}
            >
              {/* P1-5: PNG 导出选项 */}
              <div style={{ fontSize: 11, fontWeight: 600, padding: '4px 8px', color: 'var(--text, #1f2937)' }}>PNG 图片</div>
              <button type="button" data-testid="mm-export-png-1x-white" onClick={() => { onExport('png', 1, 'white'); setExportOpen(false); }} style={menuItemStyle}>1x · 白底</button>
              <button type="button" data-testid="mm-export-png-2x-white" onClick={() => { onExport('png', 2, 'white'); setExportOpen(false); }} style={menuItemStyle}>2x · 白底（高清）</button>
              <button type="button" data-testid="mm-export-png-1x-transparent" onClick={() => { onExport('png', 1, 'transparent'); setExportOpen(false); }} style={menuItemStyle}>1x · 透明底</button>
              <button type="button" data-testid="mm-export-png-2x-transparent" onClick={() => { onExport('png', 2, 'transparent'); setExportOpen(false); }} style={menuItemStyle}>2x · 透明底（高清）</button>
              <div style={{ height: 1, background: 'var(--border, #e5e7eb)', margin: '4px 0' }} />
              {/* P1-5: PDF 导出选项 */}
              <button type="button" data-testid="mm-export-pdf" onClick={() => { onExport('pdf'); setExportOpen(false); }} style={menuItemStyle}>PDF（白底）</button>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 4 }}>
        <ToolButton
          label="撤销 (Cmd/Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
          testId="mm-tool-undo"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M6 4 L 2 8 L 6 12" stroke="currentColor" fill="none" />
            <path d="M2 8 H 12 A 2 2 0 0 1 14 10 V 12" stroke="currentColor" fill="none" />
          </svg>
        </ToolButton>
        <ToolButton
          label="重做 (Cmd/Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
          testId="mm-tool-redo"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M10 4 L 14 8 L 10 12" stroke="currentColor" fill="none" />
            <path d="M14 8 H 4 A 2 2 0 0 0 2 10 V 12" stroke="currentColor" fill="none" />
          </svg>
        </ToolButton>
        <div style={{ flex: 1 }} />
        <ToolButton
          label="主题"
          active={showThemePanel}
          onClick={onToggleThemePanel}
          testId="mm-tool-themes"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" />
            <path d="M8 2 A 6 6 0 0 1 8 14" fill="currentColor" />
          </svg>
        </ToolButton>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {EDGE_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.label}
            aria-label={m.label}
            aria-pressed={edgeMode === m.id}
            data-testid={`mm-edge-mode-${m.id}`}
            onClick={() => onEdgeModeChange(m.id)}
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--border, #e5e7eb)',
              background: edgeMode === m.id ? 'var(--accent, #3b82f6)' : 'transparent',
              color: edgeMode === m.id ? 'var(--surface, #fff)' : 'var(--text, #1f2937)',
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {showThemePanel && (
        <div
          role="radiogroup"
          aria-label="脑图主题"
          data-testid="mm-theme-panel"
          style={{
            display: 'flex',
            gap: 4,
            padding: 4,
            borderTop: '1px solid var(--border, #e5e7eb)',
          }}
        >
          {MINDMAP_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === themeId}
              title={t.name}
              data-testid={`mm-theme-${t.id}`}
              onClick={() => onThemeChange(t.id)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                cursor: 'pointer',
                border: t.id === themeId ? '2px solid var(--text, #1f2937)' : '1px solid var(--border, #e5e7eb)',
                background:
                  t.branchColors.length > 1
                    ? `conic-gradient(${t.branchColors.slice(0, 4).join(', ')})`
                    : t.branchColors[0],
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function iconButtonStyle(disabled?: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    background: 'transparent',
    border: 'none',
    cursor: disabled ? 'default' : 'pointer',
    color: 'var(--text, #1f2937)',
    opacity: disabled ? 0.4 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

const menuItemStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text, #1f2937)',
  cursor: 'pointer',
  borderRadius: 4,
  fontSize: 13,
};
