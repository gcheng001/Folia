import { useEffect, useRef } from 'react';
import { Sparkles } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import { translate } from '../services/i18n';

type AiExtractionOverlayProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

const ICON_SIZE = 18;
const ICON_STROKE_WIDTH = 1.6;

/**
 * ADR-0004：AI 抽取前的隐私确认遮罩。
 *
 * 设计目标：让用户在使用「AI 可视化」按钮前清楚知道会发生什么——文件被
 * 哪个进程读取、产物落到哪里、是否会离开本机。Folia 自身不读文件，
 * 读取只发生在用户机器上的 Claude CLI 子进程里。
 */
export function AiExtractionOverlay({ onConfirm, onCancel }: AiExtractionOverlayProps) {
  const settings = useSettings();
  const t = (key: Parameters<typeof translate>[1]) => translate(settings.locale, key);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'Enter') {
        event.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onConfirm]);

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onCancel();
    }
  };

  return (
    <div
      className="ai-extraction-overlay"
      role="presentation"
      onClick={handleOverlayClick}
    >
      <div
        className="ai-extraction-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-extraction-title"
      >
        <header className="ai-extraction-header">
          <Sparkles size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          <h2 id="ai-extraction-title">{t('aiExtractionOverlayTitle')}</h2>
        </header>
        <p className="ai-extraction-body">{t('aiExtractionOverlayBody')}</p>
        <p className="ai-extraction-privacy">
          <strong>{t('aiExtractionOverlayPrivacy')}</strong>
        </p>
        <footer className="ai-extraction-footer">
          <button type="button" className="ai-extraction-cancel" onClick={onCancel}>
            {t('aiExtractionOverlayCancel')}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="ai-extraction-confirm"
            onClick={onConfirm}
          >
            {t('aiExtractionOverlayConfirm')}
          </button>
        </footer>
      </div>
    </div>
  );
}