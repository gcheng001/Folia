import {
  DIAGRAM_SCENE_VERSION,
  type DiagramElement,
  type DiagramScene,
} from './types';

export const EDITABLE_METADATA_ID = 'folia-editable-visual';

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function withoutChecksum(scene: DiagramScene): DiagramScene {
  return { ...scene, checksum: '' };
}

export function sceneChecksum(scene: DiagramScene): string {
  return fnv1a(JSON.stringify(withoutChecksum(scene)));
}

export function withSceneChecksum(scene: DiagramScene): DiagramScene {
  const draft = withoutChecksum(scene);
  return { ...draft, checksum: sceneChecksum(draft) };
}

function assertElement(value: unknown): asserts value is DiagramElement {
  if (!value || typeof value !== 'object') throw new Error('图表元素格式无效');
  const element = value as Partial<DiagramElement>;
  if (typeof element.id !== 'string' || !element.id) throw new Error('图表元素缺少编号');
  if (!['node', 'edge', 'decoration'].includes(String(element.kind))) throw new Error('图表元素类型无效');
}

export function validateDiagramScene(value: unknown): DiagramScene {
  if (!value || typeof value !== 'object') throw new Error('可编辑图表数据无效');
  const scene = value as Partial<DiagramScene>;
  if (scene.version !== DIAGRAM_SCENE_VERSION) throw new Error(`不支持的可编辑图表版本：${String(scene.version)}`);
  if (!scene.document || !scene.canvas || !Array.isArray(scene.elements)) throw new Error('可编辑图表缺少必要字段');
  if (!Number.isFinite(scene.canvas.width) || !Number.isFinite(scene.canvas.height) || scene.canvas.width! <= 0 || scene.canvas.height! <= 0) {
    throw new Error('可编辑图表画布尺寸无效');
  }
  scene.elements.forEach(assertElement);
  const ids = new Set<string>();
  for (const element of scene.elements) {
    if (ids.has(element.id)) throw new Error(`图表元素编号重复：${element.id}`);
    ids.add(element.id);
  }
  const expected = sceneChecksum(scene as DiagramScene);
  if (scene.checksum !== expected) throw new Error('可编辑图表校验失败，文件可能已损坏');
  return scene as DiagramScene;
}

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function injectSceneMetadata(svg: string, scene: DiagramScene): string {
  const clean = stripSceneMetadata(svg);
  const closing = clean.lastIndexOf('</svg>');
  if (closing < 0) throw new Error('SVG 缺少结束标签');
  const payload = escapeXmlText(JSON.stringify(withSceneChecksum(scene)));
  const metadata = `<metadata id="${EDITABLE_METADATA_ID}" data-version="${DIAGRAM_SCENE_VERSION}">${payload}</metadata>`;
  return `${clean.slice(0, closing)}${metadata}${clean.slice(closing)}`;
}

export function stripSceneMetadata(svg: string): string {
  const pattern = new RegExp(`<metadata\\s+[^>]*id=["']${EDITABLE_METADATA_ID}["'][^>]*>[\\s\\S]*?<\\/metadata>`, 'giu');
  return svg.replace(pattern, '');
}

export function readSceneMetadata(svg: string): DiagramScene | null {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('SVG XML 格式无效');
  const metadata = document.getElementById(EDITABLE_METADATA_ID);
  if (!metadata?.textContent) return null;
  return validateDiagramScene(JSON.parse(metadata.textContent));
}
