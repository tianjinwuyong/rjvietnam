// 首次启动时把管理员占位密码替换为真实哈希
import bcrypt from 'bcryptjs';
import { one, query } from '../db/index.js';
import { config } from '../config/index.js';

const PLACEHOLDER = '$2b$10$placeholder_hash_replace_on_bootstrap';

export async function bootstrapAdmin() {
  let admin;
  try {
    admin = await one(`SELECT id, password_hash FROM org_user WHERE username = 'admin'`);
  } catch (err) {
    // 数据库未就绪时不阻断服务启动，健康检查会显示 degraded
    console.warn(`  跳过管理员初始化：数据库未就绪（${err.message.slice(0, 60)}）`);
    return;
  }
  if (!admin) {
    console.warn('  未找到 admin 用户，请先执行 sql/02_seed.sql');
    return;
  }
  if (admin.password_hash !== PLACEHOLDER) return;

  // 初始密码必须由 .env 的 ADMIN_PASSWORD 显式提供（fail-closed）。
  //
  // 安全背景（B1）：历史上这里回退到硬编码 'admin123'，而那正好也是「登录页产物被
  // 预置成 admin/admin123」时用的值 ⇒ 未改密前等于公开默认口令。如今登录页已不再预填，
  // 但「默认口令」本身就是风险，因此缺失 ADMIN_PASSWORD 时**不再兜底**：
  // 直接抛错让启动失败（index.js 会 process.exit(1)），由运维补配置后重启。
  // 注意：本分支只在 password_hash 仍为占位符（首次初始化）时可达，
  // 已初始化的库不受影响，正常重启不会因此失败。
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd || !String(pwd).trim()) {
    throw new Error(
      '未初始化管理员密码：请在 .env 中设置 ADMIN_PASSWORD（不可为空）后重启服务。' +
      '为安全起见已移除内置默认口令 admin123。'
    );
  }
  const hash = await bcrypt.hash(String(pwd), config.security.bcryptRounds);
  await query(`UPDATE org_user SET password_hash = $1 WHERE id = $2`, [hash, admin.id]);
  console.log('  已初始化管理员密码：(来自 .env ADMIN_PASSWORD)');
  console.log('  请登录后立即在「个人设置」中修改密码\n');
}