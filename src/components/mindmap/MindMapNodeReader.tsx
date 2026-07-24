import { useEffect, useState } from 'react';
import { createWordPreviewArtifact } from '../../services/wordPreviewArtifactService';

interface MindMapNodeReaderProps {
  title: string;
  markdown: string;
}

export function MindMapNodeReader({ title, markdown }: MindMapNodeReaderProps): React.ReactElement {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setHtml(null);
    if (!markdown.trim()) return () => { active = false; };

    void createWordPreviewArtifact(markdown).then((artifact) => {
      if (active) setHtml(artifact.html);
    }).catch(() => {
      if (active) setHtml(null);
    });
    return () => { active = false; };
  }, [markdown]);

  return (
    <aside className="mindmap-node-reader" aria-label="节点正文" data-testid="mindmap-node-reader">
      <header className="mindmap-node-reader__header">
        <span>节点正文</span>
        <h2>{title || '未命名节点'}</h2>
      </header>
      <div className="mindmap-node-reader__body">
        {!markdown.trim() ? (
          <p className="mindmap-node-reader__empty">此节点没有独立正文。</p>
        ) : html === null ? (
          <div className="mindmap-node-reader__plain" data-testid="mindmap-node-reader-plain">{markdown}</div>
        ) : (
          <div
            className="vditor-reset mindmap-node-reader__content"
            data-testid="mindmap-node-reader-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </aside>
  );
}
