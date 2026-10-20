import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, GitFork, Minus, Network, Sparkles, Workflow, X } from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import type { AppLocale } from '../services/settingsService';
import type {
  SkillVisualStage,
  SkillVisualStyle,
  SkillVisualType,
} from '../services/skillVisualService';

type SkillVisualDialogProps = {
  sourceName: string;
  recommendedType: SkillVisualType;
  initialStyle: SkillVisualStyle;
  phase: 'configure' | 'running';
  stage: SkillVisualStage;
  model?: string;
  elapsedSeconds: number;
  error?: string;
  onGenerate: (visualType: SkillVisualType, style: SkillVisualStyle, openComparison: boolean) => void;
  onCancel: () => void;
  onMinimize: () => void;
  onClose: () => void;
};

const COPY = {
  'zh-CN': {
    title: '生成 Skill 成品图',
    subtitle: '选择这份文档最合适的表达方式和视觉风格',
    typeTitle: '图形类型',
    typeHint: '软件已根据内容给出推荐，你可以改选。',
    recommended: '推荐',
    styleTitle: '视觉风格',
    styleHint: '这份文档下次会记住你的选择。',
    privacy: '文档内容将通过本机 Claude Code 提交给 Claude 服务处理，成品保存在原文件旁。',
    review: 'AI 可能写错姓名、日期、金额或原文引述，对外使用前请核对。',
    close: '关闭',
    minimize: '收起并后台运行',
    cancel: '取消生成',
    generate: '开始生成',
    compare: '生成后在右侧打开对照（可随时关闭）',
    runningTitle: '正在绘制成品图',
    runningHint: '通常需要几十秒到几分钟。收起后可继续阅读和编辑，完成时会自动打开成品。',
    elapsed: '已等待',
    retryHint: '上次生成没有完成，你可以调整选择后重试。',
    typeNames: { flowchart: '流程图', timeline: '时间轴', relationship: '关系图', mindmap: '脑图' },
    typeDescriptions: {
      flowchart: '步骤、判断与处理程序',
      timeline: '日期、阶段与事件先后',
      relationship: '人物、机构与证据联系',
      mindmap: '主题、要点与层级结构',
    },
    styleNames: { 'light-formal': '浅色正式', business: '简洁商务', 'dark-tech': '深色科技', 'soft-color': '柔和彩色' },
    styleDescriptions: {
      'light-formal': '暖白纸面 · 赭色强调',
      business: '冷静留白 · 钢蓝灰',
      'dark-tech': '深色画布 · 高对比',
      'soft-color': '低饱和分组 · 亲和',
    },
    model: '模型',
    stages: { preparing: '准备最新文档', analyzing: '快速模型正在提取结构', drawing: '正在接收内容关系', validating: 'Folia 正在本地排版检查', saving: '保存新版本' },
  },
  'en-US': {
    title: 'Generate Skill diagram', subtitle: 'Choose the structure and visual style for this document',
    typeTitle: 'Diagram type', typeHint: 'Folia has suggested a type; you can override it.', recommended: 'Suggested',
    styleTitle: 'Visual style', styleHint: 'Folia remembers this choice for the document.',
    privacy: 'The document is sent to the Claude service through your local Claude Code, and the result is saved beside the source file.',
    review: 'AI can misstate names, dates, amounts, or quotations. Review the result before external use.',
    close: 'Close', minimize: 'Run in background', cancel: 'Cancel generation', generate: 'Generate', compare: 'Open comparison on the right when ready', runningTitle: 'Drawing your diagram',
    runningHint: 'This can take seconds or a few minutes. Minimize it to keep reading or editing; the result opens when ready.', elapsed: 'Elapsed',
    retryHint: 'The previous run did not finish. Adjust the choices and try again.',
    typeNames: { flowchart: 'Flowchart', timeline: 'Timeline', relationship: 'Relationship', mindmap: 'Mind map' },
    typeDescriptions: { flowchart: 'Steps and decisions', timeline: 'Dates and event order', relationship: 'People and evidence links', mindmap: 'Topics and hierarchy' },
    styleNames: { 'light-formal': 'Light formal', business: 'Clean business', 'dark-tech': 'Dark tech', 'soft-color': 'Soft color' },
    styleDescriptions: { 'light-formal': 'Warm paper · ochre accent', business: 'Clear space · steel gray', 'dark-tech': 'Dark canvas · high contrast', 'soft-color': 'Muted groups · approachable' },
    model: 'Model',
    stages: { preparing: 'Preparing current document', analyzing: 'Fast model is analyzing', drawing: 'Streaming the SVG', validating: 'Checking the SVG', saving: 'Saving a new version' },
  },
  'ja-JP': {
    title: 'Skill 完成図を生成', subtitle: '文書に合う図の種類とスタイルを選択します',
    typeTitle: '図の種類', typeHint: '内容に基づく推奨です。自由に変更できます。', recommended: '推奨',
    styleTitle: 'ビジュアルスタイル', styleHint: 'この文書では次回も選択が保持されます。',
    privacy: '文書内容はローカルの Claude Code 経由で Claude サービスに送信され、完成図は原文の隣に保存されます。',
    review: '氏名、日付、金額、引用に誤りが生じる場合があります。外部利用前に確認してください。',
    close: '閉じる', minimize: 'バックグラウンドで実行', cancel: '生成をキャンセル', generate: '生成を開始', compare: '完成後に右側で比較表示する', runningTitle: '完成図を作成中',
    runningHint: '数十秒から数分かかる場合があります。閉じても処理は続き、完成すると自動的に開きます。', elapsed: '経過',
    retryHint: '前回の生成は完了しませんでした。選択を調整して再試行できます。',
    typeNames: { flowchart: 'フローチャート', timeline: 'タイムライン', relationship: '関係図', mindmap: 'マインドマップ' },
    typeDescriptions: { flowchart: '手順・判断・処理', timeline: '日付・段階・順序', relationship: '人物・機関・証拠', mindmap: '主題・要点・階層' },
    styleNames: { 'light-formal': 'ライト正式', business: 'シンプル業務', 'dark-tech': 'ダーク技術', 'soft-color': 'ソフトカラー' },
    styleDescriptions: { 'light-formal': '暖かな紙面・赭色', business: '余白・スチールグレー', 'dark-tech': '暗色・高コントラスト', 'soft-color': '低彩度・親しみ' },
    model: 'モデル',
    stages: { preparing: '最新文書を準備', analyzing: '高速モデルが分析中', drawing: 'SVG をストリーミング描画中', validating: '完成図を検査', saving: '新しい版を保存' },
  },
} satisfies Record<AppLocale, object>;

const TYPE_ICONS = {
  flowchart: Workflow,
  timeline: CalendarRange,
  relationship: Network,
  mindmap: GitFork,
};

const VISUAL_TYPES: SkillVisualType[] = ['flowchart', 'timeline', 'relationship', 'mindmap'];
const VISUAL_STYLES: SkillVisualStyle[] = ['light-formal', 'business', 'dark-tech', 'soft-color'];

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`;
}

export function SkillVisualDialog({
  sourceName,
  recommendedType,
  initialStyle,
  phase,
  stage,
  model,
  elapsedSeconds,
  error,
  onGenerate,
  onCancel,
  onMinimize,
  onClose,
}: SkillVisualDialogProps) {
  const { locale } = useSettings();
  const copy = COPY[locale] as typeof COPY['zh-CN'];
  const [visualType, setVisualType] = useState<SkillVisualType>(recommendedType);
  const [style, setStyle] = useState<SkillVisualStyle>(initialStyle);
  const [openComparison, setOpenComparison] = useState(true);
  const generateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase === 'configure') generateRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (phase === 'running') onMinimize();
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onMinimize, phase]);

  const sourceLabel = useMemo(() => sourceName.replace(/\.(?:md|markdown)$/i, ''), [sourceName]);

  return (
    <div className="skill-visual-overlay" role="presentation">
      <section className="skill-visual-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-visual-title">
        <header className="skill-visual-header">
          <div className="skill-visual-heading-mark" aria-hidden="true"><Sparkles size={18} strokeWidth={1.6} /></div>
          <div>
            <h2 id="skill-visual-title">{phase === 'running' ? copy.runningTitle : copy.title}</h2>
            <p>{phase === 'running' ? sourceLabel : copy.subtitle}</p>
          </div>
          <button
            className="skill-visual-close"
            type="button"
            onClick={phase === 'running' ? onMinimize : onClose}
            aria-label={phase === 'running' ? copy.minimize : copy.close}
            title={phase === 'running' ? copy.minimize : copy.close}
          >
            {phase === 'running'
              ? <Minus size={17} strokeWidth={1.6} />
              : <X size={17} strokeWidth={1.6} />}
          </button>
        </header>

        {phase === 'running' ? (
          <div className="skill-visual-running" aria-live="polite">
            <div className="skill-visual-progress-art" aria-hidden="true">
              <span className="skill-visual-progress-node" />
              <span className="skill-visual-progress-line" />
              <span className="skill-visual-progress-node" />
              <span className="skill-visual-progress-line" />
              <span className="skill-visual-progress-node active" />
            </div>
            <strong>{copy.stages[stage]}</strong>
            <span className="skill-visual-elapsed">
              {copy.elapsed} {formatElapsed(elapsedSeconds)}{model ? ` · ${copy.model} ${model}` : ''}
            </span>
            <p>{copy.runningHint}</p>
          </div>
        ) : (
          <div className="skill-visual-config">
            {error && <div className="skill-visual-error" role="alert"><strong>{copy.retryHint}</strong><span>{error}</span></div>}
            <fieldset className="skill-visual-section">
              <legend>{copy.typeTitle}</legend>
              <p>{copy.typeHint}</p>
              <div className="skill-visual-type-grid">
                {VISUAL_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      className={`skill-visual-type ${visualType === type ? 'selected' : ''}`}
                      onClick={() => setVisualType(type)}
                      aria-pressed={visualType === type}
                    >
                      <Icon size={19} strokeWidth={1.5} />
                      <span><strong>{copy.typeNames[type]}</strong><small>{copy.typeDescriptions[type]}</small></span>
                      {recommendedType === type && <em>{copy.recommended}</em>}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="skill-visual-section">
              <legend>{copy.styleTitle}</legend>
              <p>{copy.styleHint}</p>
              <div className="skill-visual-style-grid">
                {VISUAL_STYLES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`skill-visual-style skill-visual-style--${item} ${style === item ? 'selected' : ''}`}
                    onClick={() => setStyle(item)}
                    aria-pressed={style === item}
                  >
                    <span className="skill-visual-style-preview" aria-hidden="true">
                      <i /><b /><i /><b /><i />
                    </span>
                    <span><strong>{copy.styleNames[item]}</strong><small>{copy.styleDescriptions[item]}</small></span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="skill-visual-notices">
              <label className="skill-visual-compare"><input type="checkbox" checked={openComparison} onChange={(event) => setOpenComparison(event.target.checked)} />{copy.compare}</label>
              <p>{copy.privacy}</p>
              <p>{copy.review}</p>
            </div>
          </div>
        )}

        <footer className="skill-visual-footer">
          {phase === 'running' ? (
            <>
              <span>{sourceLabel}</span>
              <button type="button" className="skill-visual-secondary" onClick={onCancel}>{copy.cancel}</button>
              <button type="button" className="skill-visual-primary" onClick={onMinimize}>
                <Minus size={15} strokeWidth={1.7} />{copy.minimize}
              </button>
            </>
          ) : (
            <>
              <span>{sourceLabel}</span>
              <button
                ref={generateRef}
                type="button"
                className="skill-visual-primary"
                onClick={() => onGenerate(visualType, style, openComparison)}
              >
                <Sparkles size={15} strokeWidth={1.7} />{copy.generate}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
