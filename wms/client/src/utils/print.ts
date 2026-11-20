/**
 * 带文件名的打印：浏览器「另存为 PDF / 打印」的默认文件名取自 document.title，
 * 这里在打印前临时替换标题，打印结束后还原。
 */
export function printWithTitle(rawTitle: string) {
  const prev = document.title;
  const clean = String(rawTitle || '')
    .replace(/[\\/:*?"<>|]/g, '-') // 去掉 Windows 文件名非法字符
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (clean) document.title = clean;

  const restore = () => {
    document.title = prev;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
  // 兜底：部分浏览器不触发 afterprint
  window.setTimeout(restore, 1500);
}
