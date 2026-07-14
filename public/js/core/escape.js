/** 单一 HTML 转义工具；列表渲染优先 textContent，确需 HTML 时只用本函数。 */
export function escapeHtml(input) {
  return String(input == null ? '' : input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}