// ============================================================
// 考试服务（批次 3）
// ------------------------------------------------------------
// 链路：培训计划(training_plan) → 计划成员(training_plan_member)
//        → 考试(exam) → 题目(exam_question) → 答卷(exam_attempt)
//
// 关键约束：
//   · 一场考试只绑一个培训计划（用户 2026-10-19 拍板）
//   · 倒计时以 attempt.deadline_at 为准：开始考试时固化为 now + duration_min
//   · 题目答案绝不下发考生端（getAttempt 会剔除 answer）
//   · 判分为百分制：得分 = 答对分值 / 总分 * 100，四舍五入到整数，≥ pass_score 及格
//   · 重考：attempt_no 递增，保留历史；发布时为每个成员建第一份 pending 答卷
// ============================================================
import { many, one, query, transaction } from '../db/index.js';
import { notifyMany } from './notify.js';

const EXAM_STATUS = new Set(['draft', 'published', 'closed']);
const QTYPES = new Set(['choice', 'multi', 'judge']);

function bizError(msg, statusCode = 400) {
  const e = new Error(msg);
  e.statusCode = statusCode;
  e.isBiz = true;
  return e;
}

function normStatus(s, def = 'draft') {
  return EXAM_STATUS.has(s) ? s : def;
}

function toIntOr(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

/* ------------------------------------------------------------------ */
/* 考试定义                                                             */
/* ------------------------------------------------------------------ */

export async function listExams({ planId, status, keyword, page = 1, size = 20 } = {}) {
  const where = [];
  const args = [];
  if (planId) { args.push(planId); where.push(`e.plan_id = $${args.length}`); }
  if (status) { args.push(status); where.push(`e.status = $${args.length}`); }
  if (keyword) {
    args.push(`%${String(keyword).trim()}%`);
    where.push(`(e.title ILIKE $${args.length} OR e.title_vi ILIKE $${args.length})`);
  }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await one(
    `SELECT COUNT(*)::int AS n FROM exam e ${cond}`, args
  );
  args.push(size, (page - 1) * size);
  const rows = await many(
    `SELECT e.*, p.title AS plan_title, p.plan_no, p.training_type,
            (SELECT COUNT(*)::int FROM exam_question q WHERE q.exam_id = e.id) AS q_count,
            (SELECT COUNT(*)::int FROM exam_attempt a WHERE a.exam_id = e.id) AS a_count,
            (SELECT COUNT(*)::int FROM exam_attempt a WHERE a.exam_id = e.id AND a.status = 'submitted') AS done_count
       FROM exam e
       JOIN training_plan p ON p.id = e.plan_id
       ${cond}
      ORDER BY e.id DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  return { list: rows, total: totalRow?.n || 0, page, pageSize: size };
}

export async function getExam(id) {
  const e = await one(
    `SELECT e.*, p.title AS plan_title, p.plan_no, p.training_type
       FROM exam e JOIN training_plan p ON p.id = e.plan_id WHERE e.id = $1`, [id]
  );
  if (!e) throw bizError('考试不存在', 404);
  const qs = await listQuestions(id);
  const stats = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted,
            COUNT(*) FILTER (WHERE passed = TRUE)::int AS passed
       FROM exam_attempt WHERE exam_id = $1`, [id]
  );
  return { ...e, questions: qs, stats };
}

export async function createExam(data = {}, userId = null) {
  const title = String(data.title || '').trim();
  if (!title) throw bizError('请填写考试名称');
  const planId = Number(data.planId);
  if (!Number.isFinite(planId)) throw bizError('请选择培训计划');
  const plan = await one(`SELECT id FROM training_plan WHERE id = $1`, [planId]);
  if (!plan) throw bizError('培训计划不存在', 404);

  const duration = Math.max(1, Math.min(600, toIntOr(data.durationMin, 30)));
  const passScore = Math.max(1, Math.min(100, toIntOr(data.passScore, 70)));

  const row = await one(
    `INSERT INTO exam (plan_id, title, title_vi, duration_min, pass_score, start_at, end_at,
                       question_count, shuffle, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [planId, title, String(data.titleVi || '').trim() || null, duration, passScore,
      data.startAt || null, data.endAt || null,
      Math.max(0, toIntOr(data.questionCount, 0)), data.shuffle === true,
      normStatus(data.status, 'draft'), userId]
  );
  return row;
}

export async function updateExam(id, data = {}) {
  const cur = await one(`SELECT * FROM exam WHERE id = $1`, [id]);
  if (!cur) throw bizError('考试不存在', 404);
  const title = data.title === undefined ? cur.title : String(data.title || '').trim();
  if (!title) throw bizError('请填写考试名称');

  const row = await one(
    `UPDATE exam SET title = $2, title_vi = $3, duration_min = $4, pass_score = $5,
            start_at = $6, end_at = $7, question_count = $8, shuffle = $9,
            status = $10, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, title,
      data.titleVi === undefined ? cur.title_vi : (String(data.titleVi || '').trim() || null),
      data.durationMin === undefined ? cur.duration_min : Math.max(1, Math.min(600, toIntOr(data.durationMin, cur.duration_min))),
      data.passScore === undefined ? cur.pass_score : Math.max(1, Math.min(100, toIntOr(data.passScore, cur.pass_score))),
      data.startAt === undefined ? cur.start_at : (data.startAt || null),
      data.endAt === undefined ? cur.end_at : (data.endAt || null),
      data.questionCount === undefined ? cur.question_count : Math.max(0, toIntOr(data.questionCount, 0)),
      data.shuffle === undefined ? cur.shuffle : data.shuffle === true,
      data.status === undefined ? cur.status : normStatus(data.status, cur.status)]
  );
  return row;
}

export async function deleteExam(id) {
  const r = await query(`DELETE FROM exam WHERE id = $1`, [id]);
  if (!r.rowCount) throw bizError('考试不存在', 404);
  return { id };
}

/* ------------------------------------------------------------------ */
/* 题库                                                                 */
/* ------------------------------------------------------------------ */

function normOptions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((o, i) => ({
      key: String(o?.key || String.fromCharCode(65 + i)).toUpperCase(),
      text: String(o?.text ?? '').trim(),
    }))
    .filter(o => o.text);
}

function normAnswer(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[，\s]+/g, ',');
}

export async function listQuestions(examId, { withAnswer = true } = {}) {
  const rows = await many(
    `SELECT id, exam_id, question, qtype, options, ${withAnswer ? 'answer,' : ''} category,
            stem_html, score, sort, created_at
       FROM exam_question WHERE exam_id = $1 ORDER BY sort, id`,
    [examId]
  );
  return rows;
}

export async function saveQuestion(examId, data = {}, id = null) {
  const exam = await one(`SELECT id FROM exam WHERE id = $1`, [examId]);
  if (!exam) throw bizError('考试不存在', 404);

  const qtype = QTYPES.has(data.qtype) ? data.qtype : 'choice';
  const question = String(data.question || '').trim();
  const stemHtml = String(data.stemHtml || '').trim() || null;
  if (!question && !stemHtml) throw bizError('请填写题干');

  let options = normOptions(data.options);
  if (qtype === 'judge') {
    options = options.length ? options : [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
  }
  if (qtype !== 'judge' && options.length < 2) throw bizError('至少需要两个选项');

  let answer = normAnswer(data.answer);
  if (!answer) throw bizError('请填写正确答案');
  const keys = options.map(o => o.key);
  const picked = answer.split(',').filter(Boolean);
  if (!picked.every(k => keys.includes(k))) throw bizError('正确答案必须落在选项内');
  if (qtype !== 'multi' && picked.length > 1) throw bizError('单选/判断题只能有一个答案');
  if (qtype === 'multi') answer = [...new Set(picked)].sort().join(',');

  const score = Math.max(1, Math.min(100, toIntOr(data.score, 1)));
  const sort = toIntOr(data.sort, 0);

  if (id) {
    const row = await one(
      `UPDATE exam_question SET question = $2, qtype = $3, options = $4, answer = $5,
              stem_html = $6, score = $7, sort = $8
        WHERE id = $1 AND exam_id = $9 RETURNING *`,
      [id, question || '（富文本题干）', qtype, JSON.stringify(options), answer,
        stemHtml, score, sort, examId]
    );
    if (!row) throw bizError('题目不存在', 404);
    return row;
  }
  return one(
    `INSERT INTO exam_question (exam_id, question, qtype, options, answer, stem_html, score, sort, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [examId, question || '（富文本题干）', qtype, JSON.stringify(options), answer,
      stemHtml, score, sort, data.category || null]
  );
}

export async function deleteQuestion(id, examId) {
  const r = await query(`DELETE FROM exam_question WHERE id = $1 AND exam_id = $2`, [id, examId]);
  if (!r.rowCount) throw bizError('题目不存在', 404);
  return { id };
}

/** 批量导入（前端解析 Excel 后提交结构化数组） */
export async function importQuestions(examId, list = []) {
  if (!Array.isArray(list) || !list.length) throw bizError('没有可导入的题目');
  const exam = await one(`SELECT id FROM exam WHERE id = $1`, [examId]);
  if (!exam) throw bizError('考试不存在', 404);

  let ok = 0;
  const errors = [];
  const baseSort = (await one(
    `SELECT COALESCE(MAX(sort), 0)::int AS s FROM exam_question WHERE exam_id = $1`, [examId]
  ))?.s || 0;

  for (let i = 0; i < list.length; i++) {
    const it = list[i] || {};
    try {
      await saveQuestion(examId, { ...it, sort: baseSort + i + 1 });
      ok += 1;
    } catch (err) {
      errors.push(`第 ${i + 1} 行：${err.message}`);
    }
  }
  return { ok, failed: errors.length, errors: errors.slice(0, 20) };
}

/* ------------------------------------------------------------------ */
/* 发布 + 推送                                                          */
/* ------------------------------------------------------------------ */

export async function publishExam(id) {
  const exam = await one(`SELECT * FROM exam WHERE id = $1`, [id]);
  if (!exam) throw bizError('考试不存在', 404);

  const qn = (await one(
    `SELECT COUNT(*)::int AS n FROM exam_question WHERE exam_id = $1`, [id]
  ))?.n || 0;
  if (!qn) throw bizError('请先添加题目再发布');

  const members = await many(
    `SELECT m.user_id, u.real_name FROM training_plan_member m
       JOIN org_user u ON u.id = m.user_id
      WHERE m.plan_id = $1`, [exam.plan_id]
  );
  if (!members.length) throw bizError('该培训计划还没有参训员工，请先导入名单');

  const created = [];
  await transaction(async (client) => {
    await client.query(`UPDATE exam SET status = 'published', updated_at = now() WHERE id = $1`, [id]);
    for (const m of members) {
      // 已存在首份答卷则跳过（重复发布不重复建）
      const exist = await client.query(
        `SELECT id FROM exam_attempt WHERE exam_id = $1 AND user_id = $2 AND attempt_no = 1`,
        [id, m.user_id]
      );
      if (exist.rowCount) continue;
      const r = await client.query(
        `INSERT INTO exam_attempt (exam_id, user_id, attempt_no, status)
         VALUES ($1,$2,1,'pending') RETURNING id`,
        [id, m.user_id]
      );
      created.push({ attemptId: Number(r.rows[0].id), userId: Number(m.user_id) });
    }
  });

  if (created.length) {
    await notifyMany(created.map(c => c.userId), {
      title: `待考试：${exam.title}`,
      content: `时长 ${exam.duration_min} 分钟，及格线 ${exam.pass_score} 分，请在规定时间内完成。`,
      category: 'exam',
      link: '/exam',
    }).catch(() => null);
  }

  return { id, notified: created.length, totalMembers: members.length };
}

export async function closeExam(id) {
  const r = await query(`UPDATE exam SET status = 'closed', updated_at = now() WHERE id = $1 RETURNING id`, [id]);
  if (!r.rowCount) throw bizError('考试不存在', 404);
  return { id };
}

/* ------------------------------------------------------------------ */
/* 考生端                                                               */
/* ------------------------------------------------------------------ */

export async function listMyExams(userId) {
  const rows = await many(
    `SELECT a.id AS attempt_id, a.status, a.score, a.passed, a.started_at, a.deadline_at,
            a.submitted_at, a.attempt_no,
            e.id AS exam_id, e.title, e.title_vi, e.duration_min, e.pass_score,
            e.start_at, e.end_at, e.status AS exam_status,
            p.title AS plan_title, p.training_type
       FROM exam_attempt a
       JOIN exam e ON e.id = a.exam_id
       JOIN training_plan p ON p.id = e.plan_id
      WHERE a.user_id = $1
      ORDER BY (a.status = 'pending' OR a.status = 'in_progress') DESC, a.id DESC
      LIMIT 200`,
    [userId]
  );
  return rows;
}

/** 取答卷（考生视角）：开始或继续，返回题目（无答案）与剩余秒数 */
export async function getAttempt(attemptId, userId) {
  const a = await one(
    `SELECT a.*, e.title, e.title_vi, e.duration_min, e.pass_score, e.question_count,
            e.shuffle, e.start_at, e.end_at, e.status AS exam_status
       FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
      WHERE a.id = $1 AND a.user_id = $2`, [attemptId, userId]
  );
  if (!a) throw bizError('答卷不存在', 404);
  if (a.exam_status === 'draft') throw bizError('考试尚未发布');
  if (a.status === 'submitted' || a.status === 'expired') {
    return {
      attemptId: Number(a.id), status: a.status, finished: true,
      score: Number(a.score ?? 0), passed: a.passed, submittedAt: a.submitted_at,
      title: a.title, passScore: a.pass_score, questions: [],
    };
  }

  // 首考：写开始时间与截止时间（只在第一次进入时固化）
  let startedAt = a.started_at;
  let deadlineAt = a.deadline_at;
  if (!startedAt) {
    const now = new Date();
    startedAt = now;
    deadlineAt = new Date(now.getTime() + Number(a.duration_min) * 60000);
    await query(
      `UPDATE exam_attempt SET status = 'in_progress', started_at = $2, deadline_at = $3 WHERE id = $1`,
      [attemptId, startedAt, deadlineAt]
    );
  }

  const remaining = Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 1000));

  let qs = await many(
    `SELECT id, question, qtype, options, stem_html, score, sort
       FROM exam_question WHERE exam_id = $1 ORDER BY sort, id`, [a.exam_id]
  );
  if (Number(a.question_count) > 0 && qs.length > Number(a.question_count)) {
    qs = a.shuffle ? qs.sort(() => Math.random() - 0.5) : qs;
    qs = qs.slice(0, Number(a.question_count));
  } else if (a.shuffle) {
    qs = qs.sort(() => Math.random() - 0.5);
  }

  return {
    attemptId: Number(a.id), status: 'in_progress', finished: false,
    title: a.title, titleVi: a.title_vi, durationMin: a.duration_min,
    passScore: a.pass_score, deadlineAt, remaining,
    answers: a.answers || {}, questions: qs,
  };
}

/** 交卷判分 */
export async function submitAttempt(attemptId, userId, answers = {}) {
  const a = await one(
    `SELECT a.*, e.pass_score, e.duration_min, e.title
       FROM exam_attempt a JOIN exam e ON e.id = a.exam_id
      WHERE a.id = $1 AND a.user_id = $2`, [attemptId, userId]
  );
  if (!a) throw bizError('答卷不存在', 404);
  if (a.status === 'submitted') return { attemptId: Number(a.id), score: Number(a.score), passed: a.passed, duplicate: true };

  const qs = await many(
    `SELECT id, qtype, answer, score FROM exam_question WHERE exam_id = $1`, [a.exam_id]
  );
  const total = qs.reduce((s, q) => s + Number(q.score || 1), 0) || 1;
  let got = 0;
  const safeAnswers = {};
  for (const q of qs) {
    const given = String(answers?.[q.id] ?? answers?.[String(q.id)] ?? '').trim();
    if (given) safeAnswers[q.id] = given;
    if (gradeOne(q, given)) got += Number(q.score || 1);
  }
  const score = Math.round((got / total) * 100);
  const passed = score >= Number(a.pass_score);

  // 超过截止时间 60s 宽限 → 记 expired，但成绩照算
  const expired = a.deadline_at && Date.now() > new Date(a.deadline_at).getTime() + 60000;
  await query(
    `UPDATE exam_attempt SET status = $2, answers = $3, score = $4, passed = $5, submitted_at = now()
      WHERE id = $1`,
    [attemptId, expired ? 'expired' : 'submitted', JSON.stringify(safeAnswers), score, passed]
  );
  return { attemptId: Number(a.id), score, passed, expired, totalQuestions: qs.length };
}

/** 单选/多选/判断判分（答案统一大写字母；判断兼容 对/错） */
function gradeOne(q, given) {
  const norm = (s) => {
    const v = String(s || '').trim().toUpperCase();
    if (q.qtype === 'judge') {
      const map = { '对': 'A', '正确': 'A', '√': 'A', 'TRUE': 'A', 'T': 'A', '是': 'A',
        '错': 'B', '错误': 'B', '×': 'B', 'FALSE': 'B', 'F': 'B', '否': 'B' };
      return map[v] || v;
    }
    return v;
  };
  const ans = norm(q.answer);
  const g = norm(given);
  if (!g) return false;
  if (q.qtype === 'multi') {
    const set = s => [...new Set(String(s).split(/[,，\s]+/).filter(Boolean))].sort().join(',');
    return set(ans) === set(g);
  }
  return ans === g;
}

/** 管理端：某场考试的成绩单 */
export async function listAttempts(examId) {
  return many(
    `SELECT a.id AS attempt_id, a.user_id, u.real_name, u.employee_no, d.name AS dept_name, d.name_en AS dept_name_en,
            a.status, a.score, a.passed, a.started_at, a.submitted_at, a.attempt_no
       FROM exam_attempt a
       JOIN org_user u ON u.id = a.user_id
       LEFT JOIN org_department d ON d.id = u.department_id
      WHERE a.exam_id = $1
      ORDER BY a.attempt_no, u.real_name`, [examId]
  );
}

/** 重考：为当前用户开一份新答卷（管理端也可对指定人开） */
export async function retake(attemptId, userId) {
  const a = await one(`SELECT * FROM exam_attempt WHERE id = $1 AND user_id = $2`, [attemptId, userId]);
  if (!a) throw bizError('答卷不存在', 404);
  const nextNo = ((await one(
    `SELECT COALESCE(MAX(attempt_no), 0)::int AS n FROM exam_attempt WHERE exam_id = $1 AND user_id = $2`,
    [a.exam_id, userId]
  ))?.n || 0) + 1;
  const r = await one(
    `INSERT INTO exam_attempt (exam_id, user_id, attempt_no, status)
     VALUES ($1,$2,$3,'pending') RETURNING id`, [a.exam_id, userId, nextNo]
  );
  return { attemptId: Number(r.id), attemptNo: nextNo };
}
