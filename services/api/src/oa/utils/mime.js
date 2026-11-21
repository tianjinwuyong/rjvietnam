/**
 * 扩展名 → MIME 映射（下载与附件落库共用一份，避免两处表各写一套慢慢漂移）
 *
 * 用途：
 *   1. GET /api/files/* 按扩展名强制 Content-Type + nosniff，禁止浏览器猜类型
 *   2. 流程附件落库时补 mime_type（明细表「每行附件」的调用方只传路径，不带类型）
 *
 * 注意：值里带 charset 的项用于下载响应头；写入 attachment.mime_type 时同样适用。
 */
export const DOWNLOAD_MIME = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
};

/** 按文件名/路径取 MIME，未收录返回 null（调用方自行决定兜底） */
export function mimeOf(p) {
  const ext = String(p || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  return DOWNLOAD_MIME[ext] || null;
}
