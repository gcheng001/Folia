import { Download, Minus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSettings } from '../hooks/useSettings';

type SvgPreviewPaneProps = {
  source: string;
  fileName: string;
  onSaveCopy: () => void;
};

const COPY = {
  'zh-CN': { label: 'Skill 成品图预览', review: '对外使用前，请核对姓名、日期、金额和原文引述。', save: '另存副本', zoomOut: '缩小', zoomIn: '放大' },
  'en-US': { label: 'Skill diagram preview', review: 'Review names, dates, amounts, and quotations before external use.', save: 'Save a copy', zoomOut: 'Zoom out', zoomIn: 'Zoom in' },
  'ja-JP': { label: 'Skill 完成図プレビュー', review: '外部利用前に氏名、日付、金額、引用を確認してください。', save: 'コピーを保存', zoomOut: '縮小', zoomIn: '拡大' },
};

export function SvgPreviewPane({ source, fileName, onSaveCopy }: SvgPreviewPaneProps) {
  const { locale } = useSettings();
  const copy = COPY[locale];
  const [zoom, setZoom] = useState(100);
  const imageSource = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    [source],
  );

  return (
    <section className="svg-preview-pane" aria-label={copy.label}>
      <header className="svg-preview-header">
        <div>
          <strong>{fileName}</strong>
          <span>{copy.review}</span>
        </div>
        <div className="svg-preview-actions">
          <div className="svg-preview-zoom" aria-label={`${zoom}%`}>
            <button type="button" onClick={() => setZoom((value) => Math.max(50, value - 25))} disabled={zoom <= 50} title={copy.zoomOut} aria-label={copy.zoomOut}>
              <Minus size={15} strokeWidth={1.7} />
            </button>
            <output>{zoom}%</output>
            <button type="button" onClick={() => setZoom((value) => Math.min(200, value + 25))} disabled={zoom >= 200} title={copy.zoomIn} aria-label={copy.zoomIn}>
              <Plus size={15} strokeWidth={1.7} />
            </button>
          </div>
          <button type="button" className="svg-preview-save" onClick={onSaveCopy}>
            <Download size={15} strokeWidth={1.7} />{copy.save}
          </button>
        </div>
      </header>
      <div className="svg-preview-canvas">
        <div className="svg-preview-sheet" style={{ width: `${zoom}%` }}>
          <img src={imageSource} alt={fileName} draggable={false} />
        </div>
      </div>
    </section>
  );
}
