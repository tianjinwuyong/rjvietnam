import { authenticate, ok, wrap } from '../middleware/index.js';
import { toId } from '../utils/params.js';
import * as drive from '../services/drive-service.js';

export default async function driveRoutes(app) {
  app.addHook('preHandler', authenticate);

  // 根目录（顶层文件夹）
  app.get('/api/drive', wrap(async (req, reply) => {
    return ok(reply, await drive.listRoot(req.user));
  }));

  // 单个文件 / 文件夹的最新元数据（属性面板用，静态段 meta 不与 :id 冲突）
  app.get('/api/drive/meta/:type/:id', wrap(async (req, reply) => {
    const type = req.params.type === 'folder' ? 'folder' : 'file';
    const id = toId(req.params.id);
    if (id === null) return reply.code(404).send({ code: 1, msg: type === 'folder' ? '文件夹不存在' : '文件不存在' });
    return ok(reply, await drive.getItemMeta(type, id, req.user));
  }));

  // 某文件夹内容
  app.get('/api/drive/folder/:id', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (id === null) return reply.code(404).send({ code: 1, msg: '文件夹不存在' });
    return ok(reply, await drive.listFolder(id, req.user));
  }));

  // 面包屑
  app.get('/api/drive/breadcrumb/:id', wrap(async (req, reply) => {
    const id = toId(req.params.id);
    if (id === null) return reply.code(404).send({ code: 1, msg: '文件夹不存在' });
    return ok(reply, await drive.breadcrumb(id));
  }));

  // 新建文件夹
  app.post('/api/drive/folder', wrap(async (req, reply) => {
    const r = await drive.createFolder(req.body || {}, req.user);
    return ok(reply, r, '文件夹已创建');
  }));

  // 重命名文件夹
  app.put('/api/drive/folder/:id', wrap(async (req, reply) => {
    await drive.renameFolder(toId(req.params.id), req.body?.name, req.user);
    return ok(reply, null, '已重命名');
  }));

  // 删除文件夹
  app.delete('/api/drive/folder/:id', wrap(async (req, reply) => {
    await drive.deleteFolder(toId(req.params.id), req.user);
    return ok(reply, null, '文件夹已删除');
  }));

  // 新增文件（上传完成后记录）
  app.post('/api/drive/file', wrap(async (req, reply) => {
    const r = await drive.addFile(req.body || {}, req.user);
    return ok(reply, r, '文件已保存');
  }));

  // 用新内容替换文件（本地编辑后保存回公共盘）
  app.put('/api/drive/file/:id/content', wrap(async (req, reply) => {
    const r = await drive.replaceFileContent(toId(req.params.id), req.body || {}, req.user);
    return ok(reply, r, '已保存回公共盘');
  }));

  // 重命名文件
  app.put('/api/drive/file/:id', wrap(async (req, reply) => {
    await drive.renameFile(toId(req.params.id), req.body?.name, req.user);
    return ok(reply, null, '已重命名');
  }));

  // 删除文件
  app.delete('/api/drive/file/:id', wrap(async (req, reply) => {
    await drive.deleteFile(toId(req.params.id), req.user);
    return ok(reply, null, '文件已删除');
  }));

  // 权限列表
  app.get('/api/drive/acl/:folderId', wrap(async (req, reply) => {
    return ok(reply, await drive.listAcl(toId(req.params.folderId), req.user));
  }));

  // 设置某用户权限
  app.put('/api/drive/acl/:folderId', wrap(async (req, reply) => {
    await drive.setAcl(toId(req.params.folderId), req.body || {}, req.user);
    return ok(reply, null, '权限已更新');
  }));

  // 移除某用户权限
  app.delete('/api/drive/acl/:folderId/:userId', wrap(async (req, reply) => {
    await drive.removeAcl(toId(req.params.folderId), toId(req.params.userId), req.user);
    return ok(reply, null, '权限已移除');
  }));

  /* ============================================================
   * S7 公共盘增强
   * 静态路径（trash/search/share/audit）须置于 :id 动态路径之前
   * ============================================================ */

  // 移动文件（targetFolderId 为 null 表示根目录；注意不能用 Number(null)，会得到 NaN）
  app.post('/api/drive/file/:id/move', wrap(async (req, reply) => {
    const target = req.body?.targetFolderId;
    await drive.moveFile(toId(req.params.id), target ? toId(target) : null, req.user);
    return ok(reply, null, '文件已移动');
  }));

  // 复制文件（nameSuffix：重名时附加的副本后缀，由前端按当前语言传入）
  app.post('/api/drive/file/:id/copy', wrap(async (req, reply) => {
    const target = req.body?.targetFolderId;
    const r = await drive.copyFile(toId(req.params.id), target ? toId(target) : null, req.user, req.body?.nameSuffix);
    return ok(reply, r, '文件已复制');
  }));

  // 移动文件夹
  app.post('/api/drive/folder/:id/move', wrap(async (req, reply) => {
    const target = req.body?.targetFolderId;
    await drive.moveFolder(toId(req.params.id), target ? toId(target) : null, req.user);
    return ok(reply, null, '文件夹已移动');
  }));

  // 复制文件夹
  app.post('/api/drive/folder/:id/copy', wrap(async (req, reply) => {
    const target = req.body?.targetFolderId;
    const r = await drive.copyFolder(toId(req.params.id), target ? toId(target) : null, req.user, req.body?.nameSuffix);
    return ok(reply, r, '文件夹已复制');
  }));

  // 回收站列表
  app.get('/api/drive/trash', wrap(async (req, reply) => {
    return ok(reply, await drive.listTrash(req.user));
  }));

  // 回收站还原
  app.post('/api/drive/trash/:type/:id/restore', wrap(async (req, reply) => {
    const r = await drive.restoreItem(req.params.type, toId(req.params.id), req.user);
    return ok(reply, r, '已还原');
  }));

  // 回收站彻底删除
  app.post('/api/drive/trash/:type/:id/purge', wrap(async (req, reply) => {
    await drive.purgeItem(req.params.type, toId(req.params.id), req.user);
    return ok(reply, null, '已彻底删除');
  }));

  // 检索（仅返回有权限的项）
  app.get('/api/drive/search', wrap(async (req, reply) => {
    return ok(reply, await drive.searchDrive({ keyword: req.query?.keyword, user: req.user }));
  }));

  // 创建分享
  app.post('/api/drive/share', wrap(async (req, reply) => {
    const r = await drive.createShare(req.body || {}, req.user);
    return ok(reply, r, '分享链接已生成');
  }));

  // 解析分享（免登录语义：仍需登录态中间件，但对分享内容只校验 token/密码）
  app.get('/api/drive/share/:token', wrap(async (req, reply) => {
    const r = await drive.resolveShare(req.params.token, req.query?.password);
    return ok(reply, r);
  }));

  // 审计日志列表
  app.get('/api/drive/audit', wrap(async (req, reply) => {
    return ok(reply, await drive.listAudit(req.query || {}));
  }));

  // 审计导出（JSON，前端可转 CSV）
  app.get('/api/drive/audit/export', wrap(async (req, reply) => {
    return ok(reply, await drive.exportAudit());
  }));
}
