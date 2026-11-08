"""
apply-dsn-factory.py — 把 rjvietnam 仓库里所有硬编码的库名/搜索路径统一切到整合库 `factory`。

背景（2026-11-08 实测，workbuddy 008/009 + orca 独立复核）：
  1. 仓库内无任何提交配置指向 `database=factory`，应用默认仍连 `wms`（WMS 栈）
     或 `smt_factory`（services/ 栈）。
  2. 旧库仍在 → 错库**不报错**：READ 200 / WRITE 201 都过，但写进旧库。
     实测漂移：factory.rjvn.operation_log 839 行 / 最新 2026-11-08 03:07，
     wms.public.operation_log 837 行 / 最新 2026-11-06 13:11。
  3. **只改库名会打断 services/ 栈**：它硬编码 `options: "-c search_path=public"`，
     而 `factory` 的 public schema 里 **0 张表**（实测 to_regclass 全部 NULL）。
     必须同时改成 `search_path=rjvn,public`。

安全前提（实测，2026-11-08）：
  - `factory.rjvn` 是三个旧库的**严格超集**，逐表核对「不在目标库」计数均为 **0**：
      · `smt_factory.public` 82 张 → 0 missing
      · `wms.public`         78 张 → 0 missing
      · `rjvn_mgmt.public`   29 张 → 0 missing
    → 表层面切换不会缺表。
  - 行数比对：material 2487=2487 / supplier 348=348 / work_order 6=6 / bom 3=3 /
    warehouse 2=2 全一致；operation_log 839 vs 837（+2 = G5 验证写入）、
    sys_role 22 vs 21（OA 折入）—— 均为已知差异。

⚠️ **只改库名会打断整个 services/ 栈**（实测坐实）：
  - `factory` 的 `public` schema 里 **0 张表**（178 张全在 `rjvn`）。
  - `services/api/server.js:863,882` 硬编码 `options: "-c search_path=public"`
    → 改库名后裸表名 `material` / `supplier` / `operation_log` / `sys_user` 全部
    `to_regclass` 返回 NULL。
  - 其余 25 个 services/ 文件**根本不设 search_path** → 走服务端默认 `"$user", public`
    → 同样解析不到。实测：`psql -d factory` 下 `SELECT count(*) FROM material;`
    直接报 `relation "material" does not exist`。
  - `postgres` 角色**没有**角色级 search_path 覆盖（库级也没有），所以不能靠 GUC 兜底。
  → 因此每个 services/ 连接池都必须**同时**：①库名 → factory ②显式加
    `options: "-c search_path=rjvn,public"`。

ℹ️ 另注：services/ 栈里还有一批**复数表名**查询（`materials` / `material_lots` /
`bom_lines` / `stations` / `agv_fleet` / `hr_employees` / `work_orders` 等）——
实测这些表在 `smt_factory.public` 与 `factory.rjvn` **两边都不存在**，即**这些代码路径
今天就已经是坏的**，与本次切换无关（切换不构成回归）。真正的复数表在 `rjvn` 里是
`material` / `supplier` / `bom` / `work_order` 等单数名（已核实 2487/348/3/6 行）。
→ 该批代码路径属独立技术债，不在本次 DSN 切换范围内，另立 backlog。

本脚本**只改配置默认值，不碰任何数据**，且：
  - 不修改 `wms/start.bat` 生成的 .env 模板行（那是运行时交互写入的部署产物）
  - 不修改 `wms/scripts/gen-*-guide.cjs` 里的**文档字符串**（示例文案，非运行时）
  - 旧数据库一律不 DROP

用法：
    python tools/apply-dsn-factory.py --dry      # 只报告，不写
    python tools/apply-dsn-factory.py --apply    # 实际写入
"""
import argparse
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 分类规则 ────────────────────────────────────────────────────────────────
# A 类：WMS/TS 栈 —— 改库名（search_path 由 database.provider.ts 统一追加）
TS_DB_DEFAULT = [
    ("wms/server/database/database.provider.ts", "${process.env.DB_NAME || 'wms'}", "${process.env.DB_NAME || 'factory'}"),
    ("wms/server/scripts/init-db.ts",              "${process.env.DB_NAME || 'wms'}", "${process.env.DB_NAME || 'factory'}"),
    ("wms/drizzle.config.ts",                      "${process.env.DB_NAME || 'wms'}", "${process.env.DB_NAME || 'factory'}"),
]

# B 类：services/ 栈 —— 改库名 **且** 改 search_path（public → rjvn,public）
SERVICES_FILES = [
    "services/api/server.js",
    "services/api/agv-api.js",
    "services/api/src/db.js",
    "services/_shared/agent-bus.js",
    "services/_shared/db.js",
    "services/worker/agv-execute.js",
    "services/worker/agv-query.js",
    "services/worker/agv-evaluator.js",
    "services/worker/bom-auto-improvement.js",
    "services/worker/bom-execute.js",
    "services/worker/bom-query.js",
    "services/worker/bom-evaluator.js",
    "services/worker/factory-sim.js",
    "services/worker/hr-query.js",
    "services/worker/hr-execute.js",
    "services/worker/hr-evaluator.js",
    "services/worker/mes-execute.js",
    "services/worker/mes-query.js",
    "services/worker/mes-evaluator.js",
    "services/worker/pda-iqc.js",
    "services/worker/pda-receiving.js",
    "services/worker/plant-query.js",
    "services/worker/plant-execute.js",
    "services/worker/plant-evaluator.js",
    "services/worker/pmc-execute.js",
    "services/worker/pmc-query.js",
    "services/worker/pmc-evaluator.js",
    "services/worker/procurement-execute.js",
    "services/worker/procurement-query.js",
    "services/worker/rda-analyze.js",
    "services/worker/rda-manager.js",
    "services/worker/rda-query.js",
    "services/worker/rda-evaluator.js",
    "services/worker/rda-execute.js",
    "services/worker/watchdog-query.js",
    "services/worker/wms-execute.js",
    "services/worker/wms-query.js",
    "services/worker/wms-evaluator.js",
]

# C 类：配置样例文件 —— 改值
ENV_EXAMPLES = [
    ("wms/.env.example",              "DB_NAME=wms",         "DB_NAME=factory"),
    ("wms/deploy-linux/.env.example", "DB_NAME=wms",         "DB_NAME=factory"),
    ("wms/deploy-linux/install.sh",  "DB_NAME=wms",         "DB_NAME=factory"),
    (".env.example",                  "PGDATABASE=smt_factory", "PGDATABASE=factory"),
    ("docker-compose.yml",            "POSTGRES_DB: smt_factory", "POSTGRES_DB: factory"),
]

# D 类：仅供说明的文档字符串 / 部署工具（默认不改，单列出来给用户决策）
ADVISORY_ONLY = [
    "wms/start.bat",                      # 生成 .env 的交互式部署脚本（运行时会写 DB_NAME=wms）
    "wms/restore-db.js",                  # 恢复工具：故意指向独立恢复库
    "wms/scripts/gen-deploy-guide.cjs",   # 生成文档里的示例文案
    "wms/scripts/gen-portable-guide.cjs", # 同上
    "wms/scripts/fix-material-type.cjs",  # 一次性修复脚本
    "wms/scripts/fix-msl-encoding.cjs",   # 同上
    "tools/check-wms-schema.mjs",
    "tools/enable-wms.mjs",
    "wms/deploy-linux/docker-compose.yml",
    "wms/deploy-linux/backup.sh",
    "wms/deploy-linux/restore.sh",
]


def read(rel):
    p = os.path.join(REPO, rel)
    if not os.path.exists(p):
        return None
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def write(rel, txt):
    p = os.path.join(REPO, rel)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(txt)


def sub_once(txt, old, new):
    """只替换第一处；返回 (新文本, 是否命中)。"""
    if old in txt:
        return txt.replace(old, new, 1), True
    return txt, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="实际写入（默认 dry-run）")
    args = ap.parse_args()

    changes = []   # (rel, 描述, 命中数)
    advisories = []

    # ── A 类 ──────────────────────────────────────────────────────────────
    for rel, old, new in TS_DB_DEFAULT:
        txt = read(rel)
        if txt is None:
            print(f"  [SKIP] {rel} 不存在")
            continue
        n = txt.count(old)
        if n:
            changes.append((rel, f"库名默认 '{old[-6:-1]}' -> '{new[-8:-1]}'（{n} 处）", n))
            if args.apply:
                write(rel, txt.replace(old, new))
        else:
            print(f"  [MISS] {rel} 未匹配到 {old}")

    # ── B 类：services/ 栈 ────────────────────────────────────────────────
    # 库名：process.env.PGDATABASE ?? "smt_factory"  →  "factory"
    #      process.env.PGDATABASE || "smt_factory"  →  "factory"
    #      const PGDATABASE = process.env.PGDATABASE ?? 'smt_factory' → 'factory'
    #      database: 'smt_factory'（字面量）        →  'factory'
    db_pats = [
        re.compile(r'(database\s*:\s*process\.env\.PGDATABASE\s*\?\?\s*")smt_factory(")'),
        re.compile(r'(database\s*:\s*process\.env\.PGDATABASE\s*\|\|\s*")smt_factory(")'),
        re.compile(r"(const\s+PGDATABASE\s*=\s*process\.env\.PGDATABASE\s*\?\?\s*')smt_factory(')"),
        re.compile(r"(const\s+PGDATABASE\s*=\s*process\.env\.PGDATABASE\s*\|\|\s*')smt_factory(')"),
        re.compile(r"(database\s*:\s*')smt_factory(')"),
    ]
    # 已有的 options：值改为 rjvn,public
    sp_pat = re.compile(r'(options\s*:\s*"-c search_path=)public(")')
    # 新增 options：紧跟 database 行之后（保持缩进风格由捕获组带出）
    sp_insert_pat = re.compile(
        r'(database\s*:\s*(?:process\.env\.PGDATABASE\s*(?:\?\?|\|\|)\s*"factory"|PGDATABASE)\s*,)')
    for rel in SERVICES_FILES:
        txt = read(rel)
        if txt is None:
            print(f"  [SKIP] {rel} 不存在")
            continue
        new_txt = txt
        total = 0
        for pat in db_pats:
            new_txt, n = pat.subn(r"\1factory\2", new_txt)
            total += n

        if not total:
            print(f"  [MISS] {rel} 未匹配到 smt_factory 默认值")
            continue

        n_sp_repl = 0
        n_sp_add = 0
        if 'search_path' in new_txt:
            new_txt, n_sp_repl = sp_pat.subn(r"\1rjvn,public\2", new_txt)
        else:
            # 无 options → 在 database 之后插入。单行 pool 对象内联插入，
            # 多行 pool 对象换行插入并对齐缩进。
            def _add_opts(m):
                line_start = m.string.rfind("\n", 0, m.start()) + 1
                line_end = m.string.find("\n", m.end())
                if line_end == -1:
                    line_end = len(m.string)
                # 该行除 database 之外还有别的键 → 单行内联插入
                after = m.string[m.end():line_end]
                if "," in after:
                    return m.group(1) + ' options: "-c search_path=rjvn,public",' + after
                indent = re.match(r'[ \t]*', m.string[line_start:m.start()]).group(0)
                return m.group(1) + '\n' + indent + 'options: "-c search_path=rjvn,public",'
            new_txt, n_sp_add = sp_insert_pat.subn(_add_opts, new_txt)

        desc = f"库名 smt_factory -> factory（{total} 处）"
        if n_sp_repl:
            desc += f" + search_path public -> rjvn,public（{n_sp_repl} 处）"
        if n_sp_add:
            desc += f" + **新增** options:\"-c search_path=rjvn,public\"（{n_sp_add} 处）"
        changes.append((rel, desc, total))
        if args.apply:
            write(rel, new_txt)

    # ── C 类：配置样例 ────────────────────────────────────────────────────
    for rel, old, new in ENV_EXAMPLES:
        txt = read(rel)
        if txt is None:
            print(f"  [SKIP] {rel} 不存在")
            continue
        n = txt.count(old)
        if n:
            changes.append((rel, f"{old} -> {new}（{n} 处）", n))
            if args.apply:
                write(rel, txt.replace(old, new))
        else:
            print(f"  [MISS] {rel} 未匹配到 {old}")

    # ── D 类：仅提示 ──────────────────────────────────────────────────────
    for rel in ADVISORY_ONLY:
        txt = read(rel)
        if txt is None:
            continue
        hits = re.findall(r"(wms|smt_factory)", txt)
        if hits:
            advisories.append((rel, len(hits)))

    print("=" * 78)
    print(f"模式：{'APPLY（实际写入）' if args.apply else 'DRY-RUN（不写盘）'}")
    print("=" * 78)
    print(f"\n【将修改 {len(changes)} 个文件】")
    for rel, desc, n in changes:
        print(f"  {rel}")
        print(f"      {desc}")

    print(f"\n【未自动修改 · 需人工决策 {len(advisories)} 个文件】")
    for rel, n in advisories:
        print(f"  {rel}  （含 {n} 处 wms/smt_factory 字样）")
    print("  说明：这些是部署脚本 / 恢复工具 / 一次性修复脚本 / 文档生成器，")
    print("        改它们会改变部署与恢复语义，故不自动动。")

    if args.apply:
        print(f"\n已写入 {len(changes)} 个文件。")
        print("下一步：① 提交前跑 type:check / 构建；② 起服务确认 current_database()='factory'；")
        print("        ③ 金丝雀：一读一写，确认落在 factory.rjvn.<t> 且不在 wms.public.<t>。")
    else:
        print("\n（dry-run，未写任何文件）加 --apply 执行。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
