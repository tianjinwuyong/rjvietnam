/**
 * WMS 数据库初始化脚本
 * 1. 创建自定义类型 (user_profile, file_attachment)
 * 2. 建表：对「空库」执行 drizzle-kit push 生成 schema.ts 定义的全部表
 * 3. 执行 server/database/*.sql 补充脚本（幂等）：补序列 / 表 / 列 / 索引 / 约束
 * 4. 初始化默认角色和管理员账号
 * 5. 初始化系统参数
 *
 * 为什么要加第 3 步（本次回归修复的核心）：
 *   历史上本脚本只做「建类型 / 建表 / 建角色账号」，从未执行 server/database
 *   下的补充 SQL。而这些脚本负责的对象（12 个单据号序列、MRB 处置 / 退货 /
 *   返工 / 供应商欠料 / 盘点 / IQC 严格度计数等表、收料六段码唯一索引、
 *   库存标签号约束降级）都不在 schema.ts 里，也不会被 drizzle-kit push 创建。
 *   结果是：任何新部署的免安装版，一收料就因 nextval('seq_receipt_no') 报
 *   42P01（relation does not exist）而 500，若干模块整块不可用。
 *   现在把补充脚本纳入初始化链路，新部署不再复现该问题。
 *
 * 为什么「建表」只在空库执行：
 *   生产库上带数据重跑 drizzle-kit push 会生成破坏性 diff（丢弃 schema.ts 中
 *   未声明的对象，例如 supplement SQL 建的供应商欠料表、收料六段码唯一索引），
 *   且 push 本身对已建库并非幂等（会重复重写列类型并报错）。因此：
 *     · 空库 → push 全量建表；
 *     · 非空库 → 跳过 push，改由第 3 步的幂等脚本补齐缺失对象。
 */
import postgres from 'postgres';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'factory'}`;

/**
 * 补充脚本执行顺序（顺序敏感，禁止随意调整）。
 * 规则：先建表，再建依赖这些表的索引 / 约束。
 *   1) sync-schema-20261016         建 12 个序列 + schema 缺失的表 / 列 / 索引
 *   2) supplier_debt_tables         供应商欠料表（不在 schema.ts 中）
 *   3) mrb_disposition_tables       MRB 处置 / 退货 / 返工表 + 相关序列
 *   4) production_return_tables     产线退料表
 *   5) iqc_strictness_count_table   IQC 严格度计数表
 *   6) fix-constraints-20261008     依赖上面各表的唯一索引 + 库存标签号降级
 *   7) fix-qr-content-unique-20261008  收料六段码部分唯一索引（并发兜底）
 *   8) fix-iqc-lot-dedup-20261008      进行中 IQC 批次去重唯一索引
 *   9) fix-iqc-pending-isolation-20261017 待检隔离(pending_qc) + F-10 仲裁索引修复
 *                                        （必须在 fix-iqc-lot-dedup 之后；它重建 active 索引）
 *  10) fix-mrb-reviewer-20261018         MRB 评审员工号 → 账号 UUID 修正
 *  11) mrb-v2-20261018                   MRB v2：齐全性预审 4 列 + 急件 2 列 + ref_no/hold_until
 *                                        （此前漏注册，新环境会缺列）
 *  12) mrb-v2.1-20261018                 MRB v2.1：status_since / cancel_* / separation_remark /
 *                                        other_type + mrb-v2 列兜底 + MRB 保留库位 + 索引
 *  12.5) mrb-v2.2-20261018               MRB v2.2（BUG-MRB-001）：inventory 唯一索引恢复为
 *                                        普通 4 列唯一键（撤销初版部分索引方案，避免全仓
 *                                        ON CONFLICT 42P10）+ lock_reason 普通索引 +
 *                                        停用历史共享保留库位；必须在 mrb-v2.1 之后
 *                                        ⚠️ 该索引定义是**不可变契约**：后续要按「其他」处置隔离，
 *                                        一律用「一单一个专属保留库位（不同 location_id）」实现，
 *                                        不要再把 lock_reason 纳入唯一键 / 改成部分索引。
 *  13) provision-deploy-config-20261016 ⚠️必须最后执行：建不良品仓 NG01 + 库位，
 *      并据实修正 good/defective_warehouse_code。若排在 mrb_disposition_tables 之前，
 *      会被它把参数改回 WL001/NG01（不存在的环境专有编码），故顺序不可调整。
 *      （因此 mrb-v2.1 里建保留库位时「找不到不良品仓」是正常情况：
 *        MRB 服务在首次写入保留库位前会再做一次幂等补建。）
 * 以 "_" 开头的是手工运维脚本（重置序列 / 清理测试数据），不在初始化时执行。
 */
const SUPPLEMENTAL_SQL_FILES = [
  'sync-schema-20261016.sql',
  'supplier_debt_tables.sql',
  'mrb_disposition_tables.sql',
  'production_return_tables.sql',
  'iqc_strictness_count_table.sql',
  'fix-constraints-20261008.sql',
  'fix-qr-content-unique-20261008.sql',
  'fix-iqc-lot-dedup-20261008.sql',
  // F-11：待检隔离(stock_status='pending_qc') + F-10 仲裁索引修复。
  // 必须在 fix-iqc-lot-dedup 之后（重建 iqc_lot_active_dedup_uniq 为 4 列 + NULLS NOT DISTINCT）、
  // 在 provision 之前执行。
  'fix-iqc-pending-isolation-20261017.sql',
  // 物料「等级」列：主数据导入必填字段（幂等，已存在则跳过）
  'fix-material-grade-20261018.sql',
  // 评审员标识修正：mrb_reviewer.reviewer_id 里存成工号的行改写为账号 UUID（幂等）
  'fix-mrb-reviewer-20261018.sql',
  // MRB v2：齐全性预审 4 列 + 急件 2 列 + 「其他」处置 ref_no/hold_until。
  // ⚠️ 此前该文件**未注册**（全仓无引用），只在人工执行过的库里存在 →
  //    新环境装出来会缺列，Drizzle 读写即抛 column does not exist。必须补进来。
  'mrb-v2-20261018.sql',
  // MRB v2.1：status_since / cancel_* / separation_remark / other_type + 兜底 + 保留库位 + 索引
  'mrb-v2.1-20261018.sql',
  // MRB v2.2（BUG-MRB-001）：inventory 唯一键**恢复为普通 4 列唯一索引**
  // （撤销初版的部分索引方案，避免全仓 ON CONFLICT 42P10），
  // 并补 lock_reason 索引 + 停用历史共享保留库位。保留位隔离靠「一单一个库位」。
  'mrb-v2.2-20261018.sql',
  // IQC 字段拼写统一（2026-10-22）：iqc_template_item / iqc_standard_item /
  // iqc_inspection_record 三表列名 spc → spec，并把 iqc_inspection_draft.payload
  // 里 records[].spc 历史键搬成 spec。幂等：已改过的跳过。
  // ⚠️ 必须排在所有写 spc 列的历史脚本之后，否则会被重新建出 spc 列。
  'rename-spc-to-spec-20261022.sql',
  // 顺序敏感：必须排在 mrb_disposition_tables.sql 之后（见上方注释）
  'provision-deploy-config-20261016.sql',
];

/**
 * 解析补充 SQL 所在目录。
 *
 * ⚠️ 不能用 __dirname：本脚本经 ts-node 运行时会被当作 ES Module 加载，
 * ESM 下没有 __dirname；而构建产物 dist 又是 CommonJS——两种形态无法共用
 * __dirname / import.meta.url。这里改用对二者都通用的 `process.argv[1]`
 * （被执行脚本的绝对路径）来定位，再回退到 <cwd>/server/database。
 *
 * ⚠️ 仅判断目录「存在」不够：nest build 会把 server/database 下的 .ts 编译到
 * dist/database（含 .js 但不含 .sql）。因此必须以「目录里确实有补充 SQL 文件」
 * 为准，否则 dist 运行时会误取到没有 .sql 的 dist/database。
 */
function resolveSqlDir(): string {
  const sentinel = SUPPLEMENTAL_SQL_FILES[0];
  const isSqlDir = (dir: string): boolean =>
    fs.existsSync(path.join(dir, sentinel));
  const candidates: string[] = [];
  const argv1 = process.argv[1];
  if (argv1) {
    // 脚本位于 <root>/server/scripts 或 <root>/dist/scripts → 同级 ../database
    candidates.push(path.resolve(path.dirname(argv1), '../database'));
  }
  // 启动器（start.bat / start.sh）都会先 cd 到项目根目录，源码目录随包分发
  candidates.push(path.resolve(process.cwd(), 'server/database'));
  for (const dir of candidates) {
    if (isSqlDir(dir)) return dir;
  }
  return candidates[candidates.length - 1];
}

/** 项目根目录：两个启动器都会先切换到项目根，故以 cwd 为准 */
function resolveProjectRoot(): string {
  return process.cwd();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `pbkdf2:sha256:100000:${salt}:${hash}`;
}

const ROLES = [
  { roleCode: 'admin', roleName: '系统管理员', description: '系统最高权限', menuPermissions: ['*'] },
  { roleCode: 'wh_manager', roleName: '仓库主管', description: '仓库档案、库位、调拨', menuPermissions: ['warehouse', 'inventory'] },
  { roleCode: 'wh_keeper', roleName: '仓管员', description: '收料、出库、移库', menuPermissions: ['receipt', 'inventory', 'issuing'] },
  { roleCode: 'iqc_inspector', roleName: 'IQC检验员', description: '来料检验', menuPermissions: ['iqc'] },
  { roleCode: 'iqc_manager', roleName: 'IQC主管', description: 'IQC审批、模板管理', menuPermissions: ['iqc'] },
  { roleCode: 'sqe', roleName: 'SQE工程师', description: 'MRB发起', menuPermissions: ['mrb'] },
  { roleCode: 'planner', roleName: '计划员', description: '工单、物料需求', menuPermissions: ['workorder'] },
  { roleCode: 'plan_manager', roleName: '计划部主管', description: '物料需求审批', menuPermissions: ['workorder'] },
  { roleCode: 'production_material_smt', roleName: 'SMT物料员', description: 'SMT工段领料', menuPermissions: ['workorder', 'issuing'] },
  { roleCode: 'production_material_dip', roleName: '插件物料员', description: '插件工段领料', menuPermissions: ['workorder', 'issuing'] },
  { roleCode: 'production_material_assembly', roleName: '组装物料员', description: '组装工段领料', menuPermissions: ['workorder', 'issuing'] },
  { roleCode: 'production_material_packing', roleName: '包装物料员', description: '包装工段领料', menuPermissions: ['workorder', 'issuing'] },
  { roleCode: 'production_manager', roleName: '生产主管', description: '领料单审批', menuPermissions: ['workorder', 'issuing'] },
  { roleCode: 'engineer', roleName: '工程师', description: 'BOM维护', menuPermissions: ['bom', 'material'] },
  { roleCode: 'quality_manager', roleName: '质量经理', description: 'MRB终审', menuPermissions: ['mrb', 'iqc'] },
  { roleCode: 'mrb_reviewer', roleName: 'MRB评审员', description: 'MRB评审', menuPermissions: ['mrb'] },
];

/**
 * 建表：仅当库中「没有任何业务表」时执行 drizzle-kit push，避免对已建库
 * 做破坏性 / 非幂等的 diff。
 *
 * @param sql 已连接的 postgres 客户端
 * @returns 是否实际执行了 push
 */
async function ensureTables(sql: ReturnType<typeof postgres>): Promise<boolean> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const tableCount = Number(rows[0]?.n ?? 0);
  if (tableCount > 0) {
    console.log(`  - 库中已有 ${tableCount} 张表，跳过建表（避免破坏性 diff）`);
    return false;
  }

  const projectRoot = resolveProjectRoot();
  const schemaPath = path.join(projectRoot, 'server', 'database', 'schema.ts');
  if (!fs.existsSync(schemaPath)) {
    console.log(`  ! 未找到 schema 文件（${schemaPath}），跳过自动建表`);
    return false;
  }

  console.log('  - 检测到空库，执行 drizzle-kit push 建表...');
  // drizzle-kit 对含非 ASCII 的 Windows 绝对路径（本项目目录名含中文）解析失败，
  // 这里改传「相对 cwd 的正斜杠路径」；cwd 已固定为项目根目录。
  const schemaRel = 'server/database/schema.ts';
  // --force：自动确认所有变更，避免交互式挂起（空库场景无数据丢失风险）
  execSync(
    `npx drizzle-kit push --dialect postgresql --schema "${schemaRel}" --url "${connectionString}" --force`,
    { cwd: projectRoot, stdio: 'inherit' },
  );
  console.log('  ✓ 表结构已创建');
  return true;
}

/**
 * 按固定顺序执行 server/database 下的补充 SQL（幂等）。
 * 单个文件失败不中断后续文件，最后统一汇总；失败会以醒目警告打印。
 *
 * @param sql   已连接的 postgres 客户端
 * @param sqlDir 补充 SQL 目录
 * @returns 失败的文件名列表
 */
async function runSupplementalSql(
  sql: ReturnType<typeof postgres>,
  sqlDir: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const file of SUPPLEMENTAL_SQL_FILES) {
    const full = path.join(sqlDir, file);
    if (!fs.existsSync(full)) {
      console.log(`  ! 跳过缺失脚本：${file}`);
      failed.push(file);
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    try {
      // unsafe 且不带参数 → 走 simple query 协议，可一次执行多语句 / DO 块
      await sql.unsafe(content);
      console.log(`  ✓ ${file}`);
    } catch (e: any) {
      console.log(`  ✗ ${file} 执行失败：${e?.message ?? e}`);
      failed.push(file);
    }
  }
  return failed;
}

async function main() {
  console.log('=== WMS 数据库初始化 ===');
  console.log('连接数据库:', connectionString.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));

  // max: 1 —— 必须为单连接。补充脚本里的 fix-*.sql 含显式 BEGIN/COMMIT，
  // postgres-js 在连接池（max>1）上执行「含事务控制语句的 unsafe 多语句」时会
  // 抛 UNSAFE_TRANSACTION；限制为单连接即可安全执行。初始化本身也是串行的。
  const sql = postgres(connectionString, { max: 1 });
  const sqlDir = resolveSqlDir();
  console.log('补充 SQL 目录:', sqlDir);

  try {
    // 1. 创建自定义类型（PG16 不支持 IF NOT EXISTS，用异常捕获实现幂等）
    console.log('\n[1/5] 创建自定义类型...');
    try {
      await sql`CREATE TYPE user_profile AS (user_id text)`;
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        console.log('  - user_profile 已存在，跳过');
      } else throw e;
    }
    try {
      await sql`CREATE TYPE file_attachment AS (bucket_id text, file_path text)`;
    } catch (e: any) {
      if (e.message?.includes('already exists')) {
        console.log('  - file_attachment 已存在，跳过');
      } else throw e;
    }
    console.log('  ✓ user_profile, file_attachment 类型已就绪');

    // 2. 建表（仅空库）
    console.log('\n[2/5] 检查 / 创建表结构...');
    await ensureTables(sql as any);

    // 3. 补充 SQL（序列 / 表 / 列 / 索引 / 约束），幂等
    console.log('\n[3/5] 执行补充 SQL 脚本...');
    const failedFiles = await runSupplementalSql(sql as any, sqlDir);
    if (failedFiles.length > 0) {
      console.log(
        `\n  [警告] 有 ${failedFiles.length} 个补充脚本执行失败：${failedFiles.join(', ')}`,
      );
      console.log('         服务仍会继续启动，但相关模块可能不可用；请检查上方报错并重跑本脚本。');
    }

    // 4. 初始化角色
    console.log('\n[4/5] 初始化角色...');
    for (const role of ROLES) {
      await sql`
        INSERT INTO sys_role (role_code, role_name, description, menu_permissions, status)
        VALUES (${role.roleCode}, ${role.roleName}, ${role.description}, ${role.menuPermissions as any}, 'active')
        ON CONFLICT (role_code) DO NOTHING
      `;
    }
    console.log(`  ✓ ${ROLES.length} 个角色已初始化`);

    // 5. 初始化管理员账号 + 系统参数
    console.log('\n[5/5] 初始化管理员账号与系统参数...');
    const adminHash = hashPassword('admin');
    await sql`
      INSERT INTO sys_account (account, password_hash, name, role_code, status, is_first_login)
      VALUES ('admin', ${adminHash}, '系统管理员', 'admin', 'active', true)
      ON CONFLICT (account) DO NOTHING
    `;
    console.log('  ✓ admin / admin 账号已就绪（首次登录后请修改密码）');

    const params = [
      { key: 'company_name', value: '深圳市瑞晶实验有限公司', name: '公司名称' },
      { key: 'default_warehouse_type', value: 'normal', name: '默认仓库类型' },
      { key: 'expiry_warning_days', value: '30', name: '有效期预警天数' },
      { key: 'iqc_pending_warning_hours', value: '24', name: 'IQC待检预警小时数' },
      { key: 'iqc_pending_urgent_hours', value: '48', name: 'IQC待检紧急小时数' },
    ];
    for (const p of params) {
      await sql`
        INSERT INTO sys_param (param_key, param_value, param_name_zh)
        VALUES (${p.key}, ${p.value}, ${p.name})
        ON CONFLICT (param_key) DO NOTHING
      `;
    }
    console.log(`  ✓ ${params.length} 个系统参数已初始化`);

    console.log('\n=== 数据库初始化完成 ===');
    console.log('默认登录: admin / admin');
  } catch (err) {
    console.error('初始化失败:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
