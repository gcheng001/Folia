import { EDITABLE_METADATA_ID } from './sceneSchema';

/** 生成对外交付 SVG：删除可编辑场景、脚本、外链、事件属性和内部选中标记。 */
export function prepareDeliverySvg(source: string): string {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('SVG 格式无效');
  document.getElementById(EDITABLE_METADATA_ID)?.remove();
  document.querySelectorAll('script, foreignObject').forEach((element) => element.remove());
  for (const element of Array.from(document.documentElement.querySelectorAll('*'))) {
    element.removeAttribute('data-folia-id');
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.toLowerCase();
      if (name.startsWith('on') || value.includes('javascript:') || /https?:\/\//u.test(value)) element.removeAttribute(attribute.name);
    }
    if (element.localName === 'style' && /@import|https?:\/\//iu.test(element.textContent ?? '')) element.remove();
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}
