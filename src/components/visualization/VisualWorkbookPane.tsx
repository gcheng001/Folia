import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { addRecommendedSheet } from '../../services/visualization/draft';
import { parseVisualWorkbook, serializeVisualWorkbook, VISUALIZATION_RULES_VERSION } from '../../services/visualization/schema';
import { fingerprint } from '../../services/visualization/source';
import { buildSourceCorrection, refreshWorkbookFromSource, type SourceCorrection } from '../../services/visualization/sync';
import { downloadExport, exportElementPdf, exportElementPng, exportSheetSvg, exportWorkbookHtml } from '../../services/visualization/export';
import type { TraceableElement, ViewFamily, VisualWorkbook } from '../../services/visualization/types';
import { ChartRenderer, GraphRenderer, MatrixRenderer, TimelineRenderer } from './VisualRenderers';
import { useSettings } from '../../hooks/useSettings';
import { translate } from '../../services/i18n';

interface VisualWorkbookPaneProps {
  content: string;
  onChange: (content: string) => void;
  sourceMarkdown?: string;
  onApplySourceChange?: (content: string) => void;
}

function currentTimestamp(): number {
  return Date.now();
}

function displayLabel(workbook: VisualWorkbook, element: TraceableElement): string {
  const sheet = workbook.sheets.find((candidate) => candidate.id === workbook.activeSheetId);
  const override = sheet?.presentation[element.id]?.label;
  return typeof override === 'string' ? override : element.label;
}

function familyLabel(family: ViewFamily): string {
  return ({
    'structure-overview': '结构总览',
    timeline: '时间轴',
    relationship: '关系网络',
    flow: '流程与决策',
    matrix: '矩阵与对比',
    charts: '数值图表',
  } as const)[family];
}

export function VisualWorkbookPane({ content, onChange, sourceMarkdown, onApplySourceChange }: VisualWorkbookPaneProps) {
  const settings = useSettings();
  const t = (key: Parameters<typeof translate>[1]) => translate(settings.locale, key);
  const [lastEditedId, setLastEditedId] = useState<string | null>(null);
  const [correction, setCorrection] = useState<SourceCorrection | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => {
    try {
      return { workbook: parseVisualWorkbook(content), error: null };
    } catch (error) {
      return { workbook: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [content]);

  const waitingForSource = parsed.workbook !== null && sourceMarkdown !== undefined && (
    parsed.workbook.rulesVersion !== VISUALIZATION_RULES_VERSION
    || parsed.workbook.sheets.some((sheet) =>
      sheet.elements.length === 0 && sheet.reviewItems.some((item) => item.reason === 'unsupported'))
  );
  useEffect(() => {
    if (!waitingForSource || sourceMarkdown === undefined || parsed.workbook === null) return;
    onChange(serializeVisualWorkbook(refreshWorkbookFromSource(parsed.workbook, sourceMarkdown)));
  }, [onChange, parsed.workbook, sourceMarkdown, waitingForSource]);

  if (!parsed.workbook) {
    return (
      <section className="visual-workbook visual-workbook--error" role="alert">
        <h2>无法打开可视化工作簿</h2>
        <p>{parsed.error}</p>
      </section>
    );
  }

  const workbook = parsed.workbook;
  const activeSheet = workbook.sheets.find((sheet) => sheet.id === workbook.activeSheetId) ?? workbook.sheets[0];
  const commit = (next: VisualWorkbook) => onChange(serializeVisualWorkbook(next));
  const switchSheet = (id: string) => commit({ ...workbook, activeSheetId: id, updatedAt: currentTimestamp() });
  const editLabel = (element: TraceableElement, label: string) => {
    if (!activeSheet) return;
    const nextSheet = {
      ...activeSheet,
      presentation: {
        ...activeSheet.presentation,
        [element.id]: { ...activeSheet.presentation[element.id], label },
      },
      updatedAt: currentTimestamp(),
    };
    commit({
      ...workbook,
      sheets: workbook.sheets.map((sheet) => sheet.id === nextSheet.id ? nextSheet : sheet),
      updatedAt: nextSheet.updatedAt,
    });
    setLastEditedId(element.id);
  };
  const moveNode = (id: string, x: number, y: number) => {
    if (!activeSheet) return;
    const updatedAt = currentTimestamp();
    const nextSheet = {
      ...activeSheet,
      layout: { ...activeSheet.layout, [id]: { ...activeSheet.layout[id], x, y } },
      updatedAt,
    };
    commit({
      ...workbook,
      sheets: workbook.sheets.map((sheet) => sheet.id === nextSheet.id ? nextSheet : sheet),
      updatedAt,
    });
  };

  const availableRecommendations = (workbook.recommendation?.fits ?? [])
    .filter((fit) => !workbook.sheets.some((sheet) => sheet.family === fit.family));
  const pendingOverrideId = lastEditedId ?? Object.keys(activeSheet?.presentation ?? {}).find((id) => {
    const element = activeSheet?.elements.find((candidate) => candidate.id === id);
    const label = activeSheet?.presentation[id]?.label;
    return element && typeof label === 'string' && label !== element.label;
  });
  const lastEdited = activeSheet?.elements.find((element) => element.id === pendingOverrideId);
  const correctionCandidate = lastEdited && sourceMarkdown !== undefined
    ? buildSourceCorrection(lastEdited, displayLabel(workbook, lastEdited), sourceMarkdown)
    : null;
  const sourceChanged = sourceMarkdown !== undefined && fingerprint(sourceMarkdown) !== workbook.source.contentHash;
  const addAnnotation = () => {
    if (!activeSheet) return;
    const updatedAt = currentTimestamp();
    const annotation = { id: `annotation-${updatedAt}`, kind: 'note' as const, label: '新建视图注释', data: {} };
    const nextSheet = { ...activeSheet, annotations: [...activeSheet.annotations, annotation], updatedAt };
    commit({ ...workbook, sheets: workbook.sheets.map((sheet) => sheet.id === nextSheet.id ? nextSheet : sheet), updatedAt });
  };
  const editAnnotation = (id: string, label: string) => {
    if (!activeSheet) return;
    const updatedAt = currentTimestamp();
    const nextSheet = {
      ...activeSheet,
      annotations: activeSheet.annotations.map((annotation) => annotation.id === id ? { ...annotation, label } : annotation),
      updatedAt,
    };
    commit({ ...workbook, sheets: workbook.sheets.map((sheet) => sheet.id === nextSheet.id ? nextSheet : sheet), updatedAt });
  };
  const exportCurrent = async (format: 'png' | 'svg' | 'pdf' | 'html') => {
    if (!activeSheet) return;
    const stem = (workbook.title.split(/[\\/]/).pop() ?? '').replace(/[:*?"<>|]/g, '-') || 'Folia-可视化';
    try {
      setExportError(null);
      if (format === 'html') {
        downloadExport(exportWorkbookHtml(workbook, activeSheet.id), `${stem}.html`, 'text/html;charset=utf-8');
      } else if (format === 'svg') {
        const svg = exportSheetSvg(activeSheet);
        if (!svg) throw new Error('当前页签不适用 SVG 导出');
        downloadExport(svg, `${stem}.svg`, 'image/svg+xml;charset=utf-8');
      } else if (format === 'png' && sheetRef.current) {
        downloadExport(await exportElementPng(sheetRef.current), `${stem}.png`, 'image/png');
      } else if (format === 'pdf' && sheetRef.current) {
        downloadExport(await exportElementPdf(sheetRef.current), `${stem}.pdf`, 'application/pdf');
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="visual-workbook" aria-label={t('visualWorkbookAria')}>
      <header className="visual-workbook-header">
        <div className="visual-workbook-title">
          <span>{workbook.title}</span>
          <small>{t('visualSourcePrefix')}{workbook.source.relativePath}</small>
        </div>
        <div className="visual-workbook-fit" aria-label={t('visualRecommendationAria')}>
          {(workbook.recommendation?.fits ?? []).map((fit) => (
            <span key={fit.family}>{familyLabel(fit.family)} {fit.score}%</span>
          ))}
        </div>
        <div className="visual-workbook-actions">
          {sourceChanged && sourceMarkdown !== undefined && (
            <button onClick={() => commit(refreshWorkbookFromSource(workbook, sourceMarkdown))}>{t('visualReviewSource')}</button>
          )}
          <button onClick={addAnnotation}>{t('visualAddAnnotation')}</button>
          <button disabled={!correctionCandidate || !onApplySourceChange} onClick={() => setCorrection(correctionCandidate)}>{t('visualSyncSource')}</button>
          <button onClick={() => { void exportCurrent('png'); }}>PNG</button>
          <button disabled={!activeSheet || exportSheetSvg(activeSheet) === null} onClick={() => { void exportCurrent('svg'); }}>SVG</button>
          <button onClick={() => { void exportCurrent('pdf'); }}>PDF</button>
          <button onClick={() => { void exportCurrent('html'); }}>HTML</button>
        </div>
      </header>

      <nav className="visual-sheet-tabs" aria-label={t('visualSheetsAria')}>
        {workbook.sheets.map((sheet) => (
          <button
            key={sheet.id}
            className={sheet.id === activeSheet?.id ? 'active' : ''}
            onClick={() => switchSheet(sheet.id)}
          >
            {sheet.name}
          </button>
        ))}
        {availableRecommendations.map((fit) => (
          <button
            key={fit.family}
            className="visual-sheet-suggestion"
            onClick={() => commit(addRecommendedSheet(workbook, fit.family, sourceMarkdown))}
            title={fit.evidence.map((item) => `${item.label} ${item.count}`).join('；')}
          >
            <Plus size={13} /> {familyLabel(fit.family)}
          </button>
        ))}
      </nav>

      {exportError && <p className="visual-export-error" role="alert">{t('visualExportErrorPrefix')}{exportError}</p>}
      <div ref={sheetRef} className={`visual-sheet visual-sheet--${activeSheet?.family ?? 'empty'}`}>
        {!activeSheet ? (
          <p className="visual-sheet-empty">此工作簿尚无页签。</p>
        ) : activeSheet.elements.length === 0 ? (
          <div className="visual-sheet-empty">
            <p>{activeSheet.reviewItems[0]?.label ?? '此页签暂无可显示内容。'}</p>
            <small>不会在缺少原文依据时自动编造节点或关系。</small>
          </div>
        ) : activeSheet.family === 'timeline' ? (
          <TimelineRenderer sheet={activeSheet} labelFor={(element) => displayLabel(workbook, element)} onEditLabel={editLabel} onMoveNode={moveNode} />
        ) : activeSheet.family === 'matrix' ? (
          <MatrixRenderer sheet={activeSheet} labelFor={(element) => displayLabel(workbook, element)} onEditLabel={editLabel} onMoveNode={moveNode} />
        ) : activeSheet.family === 'charts' ? (
          <ChartRenderer sheet={activeSheet} labelFor={(element) => displayLabel(workbook, element)} onEditLabel={editLabel} onMoveNode={moveNode} />
        ) : (
          <GraphRenderer sheet={activeSheet} labelFor={(element) => displayLabel(workbook, element)} onEditLabel={editLabel} onMoveNode={moveNode} />
        )}
      </div>
      {activeSheet && activeSheet.annotations.length > 0 && (
        <aside className="visual-annotations" aria-label={t('visualAnnotationLabel')}>
          {activeSheet.annotations.map((annotation) => (
            <label key={annotation.id}>
              <span>{t('visualAnnotationLabel')}</span>
              <input value={annotation.label} onChange={(event) => editAnnotation(annotation.id, event.currentTarget.value)} />
            </label>
          ))}
        </aside>
      )}
      {correction && (
        <div className="visual-correction-overlay" role="dialog" aria-modal="true" aria-label={t('visualCorrectionTitle')}>
          <div className="visual-correction-dialog">
            <h3>{t('visualCorrectionTitle')}</h3>
            <p>{t('visualCorrectionHint')}</p>
            <del>{correction.before}</del>
            <ins>{correction.after}</ins>
            <div>
              <button onClick={() => setCorrection(null)}>{t('visualCancel')}</button>
              <button onClick={() => {
                onApplySourceChange?.(correction.sourceAfter);
                commit(refreshWorkbookFromSource(workbook, correction.sourceAfter));
                setCorrection(null);
              }}>{t('visualConfirmSource')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
