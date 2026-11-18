// ============================================================
// iqc-jobs —— IQC 相关的后台任务
//
// 两个定时器：
//   1) 认领超时回收：11 分钟一轮（4 小时未提交的自动释放，含 WMS 侧锁）
//   2) 跨系统对账：6 小时一轮；有红线差异就 warn（后续可接通知/看板红点）
//
// 用 setInterval + unref：不阻止进程退出；OA 是单体服务，够用，
// 不为了两个定时任务引入调度框架。
// ============================================================
import { releaseStaleClaims, retryPendingBackfill } from './oa-iqc-service.js';
import { runReconcile } from './iqc-reconcile-service.js';
import { pullPendingLots } from './wms-iqc-pull.js';
import { notifyMany } from './notify.js';
import { listAdminUserIds } from '../utils/admin.js';

let started = false;

/** 对账有红线时通知管理员/品质主管（同一条红线不重复轰炸：按 lot 去重记在内存里） */
const alerted = new Set();

async function alertReconcile(r) {
  const reds = (r.items || []).filter(i => i.level === 'red');
  if (!reds.length) return;
  const fresh = reds.filter(i => !alerted.has(i.lotNo));
  if (!fresh.length) return;
  fresh.forEach(i => alerted.add(i.lotNo));
  // 内存集合只保留最近 500 条，避免长期运行无限增长
  if (alerted.size > 500) {
    [...alerted].slice(0, alerted.size - 500).forEach(k => alerted.delete(k));
  }

  const ids = await listAdminUserIds().catch(() => []);
  if (!ids.length) return;
  await notifyMany(ids, {
    title: `【IQC 对账告警】${fresh.length} 个批次库存悬空`,
    content: `以下批次已判定但库存仍挂在待检（pending_qc），需人工核查：\n`
      + fresh.slice(0, 5).map(i => `${i.lotNo}：${i.detail}`).join('\n'),
    link: '/quality/iqc',
    category: 'todo',
  }).catch(() => {});
  console.warn(`[iqc] 已向 ${ids.length} 位管理员推送红线告警（${fresh.length} 条）`);
}

export function startIqcJobs() {
  if (started) return;
  started = true;

  // 认领超时回收
  const t1 = setInterval(() => {
    releaseStaleClaims()
      .then(r => { if (r.released) console.log(`[iqc] 认领超时释放 ${r.released} 条`); })
      .catch(e => console.warn('[iqc] 认领回收失败:', e?.message || e));
  }, 11 * 60 * 1000);
  t1.unref?.();

  // 落账补偿：审批已通过但 WMS 未回执的，5 分钟一轮自动重试
  // （流程终态钩子吞异常，WMS 抖一下就会留下"批了但库存没动"的孤儿记录）
  const t3 = setInterval(() => {
    retryPendingBackfill()
      .then(async r => {
        if (!r.retried) return;
        console.log(`[iqc] 落账补偿：重试 ${r.retried} 条，成功 ${r.ok} 条，待重试 ${r.failed.length}，转人工 ${r.dead.length}`);
        r.failed.forEach(f => console.warn(`       #${f.id} 第 ${f.attempt} 次失败：${f.error}`));
        if (r.dead.length) {
          // 转人工的必须吵一次：这是"审批通过但库存没动"的红线，安静失败等于账不平
          const ids = await listAdminUserIds().catch(() => []);
          if (ids.length) {
            await notifyMany(ids, {
              title: `【IQC 落账失败】${r.dead.length} 条已转人工`,
              content: '以下检验报告审批已通过，但回填 WMS 连续 10 次失败，库存可能仍挂在待检：\n'
                + r.dead.slice(0, 5).map(x => `报告 #${x.id}：${x.error}`).join('\n'),
              link: '/quality/iqc',
              category: 'todo',
            }).catch(() => {});
          }
        }
      })
      .catch(e => console.warn('[iqc] 落账补偿失败:', e?.message || e));
  }, 60 * 1000);
  t3.unref?.();

  // 对账
  const t2 = setInterval(() => {
    runReconcile({ days: 7 })
      .then(async r => {
        if (r.summary.red > 0) {
          console.warn(`[iqc] 对账发现 ${r.summary.red} 条红线（库存悬空），请立即检查`);
          for (const it of r.items.filter(i => i.level === 'red').slice(0, 5)) {
            console.warn(`       ${it.lotNo} ${it.detail}`);
          }
          await alertReconcile(r);
        } else if (r.summary.total > 0) {
          console.log(`[iqc] 对账差异 ${r.summary.total} 条（red ${r.summary.red} / orange ${r.summary.orange} / yellow ${r.summary.yellow}）`);
        }
      })
      .catch(e => console.warn('[iqc] 对账失败:', e?.message || e));
  }, 6 * 60 * 60 * 1000);
  t2.unref?.();

  // 主动拉取 WMS 待检批次（2026-10-25 新增）
  // 原设计只等 WMS 推送，而 WMS 侧推过来的请求在 OA 没有 API Key 时全部 401、
  // 退避 8 次后被置 failed 不再重试 —— 结果「IQC 检验」页面永远是「待检批次 0」。
  // 这里改成 OA 自己按 WMS 待检页同一口径拉，每 5 分钟一轮，不依赖对方队列状态。
  const t4 = setInterval(() => {
    pullPendingLots()
      .then(r => {
        if (r.skipped) return;
        if (r.inserted || r.updated) {
          console.log(`[iqc] 待检同步：拉取 ${r.fetched}，新增 ${r.inserted}，刷新 ${r.updated}，绑模板 ${r.withTemplate}`);
        }
        if (r.errors?.length) {
          console.warn(`[iqc] 待检同步有 ${r.errors.length} 条失败：${r.errors.slice(0, 3).join('；')}`);
        }
      })
      .catch(e => console.warn('[iqc] 待检同步失败:', e?.message || e));
  }, 5 * 60 * 1000);
  t4.unref?.();

  // 启动 20s 后先拉一轮（重启后页面立刻有数据，不用等 5 分钟）
  const bootPull = setTimeout(() => {
    pullPendingLots()
      .then(r => { if (!r.skipped && (r.inserted || r.updated)) console.log(`[iqc] 启动待检同步：新增 ${r.inserted}，刷新 ${r.updated}`); })
      .catch(() => {});
  }, 20 * 1000);
  bootPull.unref?.();

  // 启动 60s 后先跑一次对账（让重启后的状态可见）
  const boot = setTimeout(() => {
    runReconcile({ days: 7 })
      .then(r => { if (r.summary.total) console.log(`[iqc] 启动对账：差异 ${r.summary.total} 条（红线 ${r.summary.red}）`); })
      .catch(() => {});
  }, 60 * 1000);
  boot.unref?.();

  console.log('[iqc] 后台任务已启动（认领回收 11min / 待检同步 5min / 对账 6h）');
}
