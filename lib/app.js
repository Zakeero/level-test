// Registon — daraja o'tish test platformasi (API)
// Vercel'da api/index.js orqali, lokalda dev.js orqali ishlaydi.
const express = require('express');
const crypto = require('crypto');
const { Pool, types } = require('pg');

types.setTypeParser(20, Number); // BIGINT/COUNT → oddiy son

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SECRET || crypto.createHash('sha256').update('registan:' + ADMIN_PASSWORD).digest('hex');
const GRACE_SECONDS = 30;       // tarmoq kechikishi uchun qo'shimcha vaqt
const MAX_EVENTS_LOGGED = 60;   // bitta urinishda saqlanadigan hodisalar soni

if (ADMIN_PASSWORD === 'admin123') console.warn('⚠️  ADMIN_PASSWORD o\'rnatilmagan — standart parol "admin123". O\'zgartiring!');

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  max: 3,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
}) : null;

const q = async (sql, params) => (await pool.query(sql, params)).rows;
const one = async (sql, params) => (await pool.query(sql, params)).rows[0];

// ---------- baza tuzilmasi (birinchi so'rovda avtomatik yaratiladi/yangilanadi) ----------
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tests (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    level_from TEXT NOT NULL,
    level_to TEXT NOT NULL,
    description TEXT DEFAULT '',
    duration_min INT NOT NULL DEFAULT 40,
    pass_percent INT NOT NULL DEFAULT 70,
    shuffle BOOLEAN NOT NULL DEFAULT TRUE,
    show_answers BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE tests
    ADD COLUMN IF NOT EXISTS max_violations INT NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS reading_blocks INT NOT NULL DEFAULT 0,    -- 0 = bankdagi hammasi
    ADD COLUMN IF NOT EXISTS listening_blocks INT NOT NULL DEFAULT 0;

  -- Har bir bo'limdan nechta savol tushishi (0 yoki yozuv yo'q = hammasi)
  CREATE TABLE IF NOT EXISTS section_quotas (
    test_id INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (test_id, section)
  );

  CREATE TABLE IF NOT EXISTS passages (
    id SERIAL PRIMARY KEY,
    test_id INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'reading',       -- reading | listening
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',              -- o'qish matni yoki topshiriq
    audio_url TEXT NOT NULL DEFAULT '',
    max_plays INT NOT NULL DEFAULT 0,           -- 0 = cheklanmagan
    position INT NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    test_id INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    section TEXT NOT NULL DEFAULT 'Grammar',
    text TEXT NOT NULL,
    options TEXT NOT NULL,
    correct INT NOT NULL,
    points INT NOT NULL DEFAULT 1,
    position INT NOT NULL DEFAULT 0
  );
  ALTER TABLE questions ADD COLUMN IF NOT EXISTS passage_id INT REFERENCES passages(id) ON DELETE CASCADE;

  CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS study_groups (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    test_id INT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    group_name TEXT DEFAULT '',
    teacher TEXT DEFAULT '',
    question_order TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    deadline BIGINT NOT NULL,
    finished_at BIGINT,
    answers TEXT,
    score INT,
    max_score INT,
    percent INT,
    passed BOOLEAN,
    sections TEXT
  );
  ALTER TABLE attempts
    ADD COLUMN IF NOT EXISTS teacher_id INT,
    ADD COLUMN IF NOT EXISTS group_id INT,
    ADD COLUMN IF NOT EXISTS violations INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS events TEXT NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS finish_reason TEXT NOT NULL DEFAULT '';

  CREATE INDEX IF NOT EXISTS idx_q_test ON questions(test_id);
  CREATE INDEX IF NOT EXISTS idx_q_passage ON questions(passage_id);
  CREATE INDEX IF NOT EXISTS idx_p_test ON passages(test_id);
  CREATE INDEX IF NOT EXISTS idx_a_test ON attempts(test_id);
  CREATE INDEX IF NOT EXISTS idx_a_finished ON attempts(finished_at);
  CREATE INDEX IF NOT EXISTS idx_g_teacher ON study_groups(teacher_id);
` + require('./speaking').SCHEMA;

let ready;
function init() {
  ready ??= (async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(771001)');
      await c.query(SCHEMA);
      const { rows } = await c.query('SELECT COUNT(*) c FROM tests');
      if (rows[0].c === 0) {
        await require('./seed')(c);
        console.log('✅ Namuna testlar yuklandi');
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      ready = null;
      throw e;
    } finally {
      c.release();
    }
  })();
  return ready;
}

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

const app = express();
app.set('trust proxy', true);

// Vercel so'rov tanasini o'zi o'qib beradi; lokalda express.json ishlaydi
const jsonParser = express.json({ limit: '10mb' });
app.use((req, res, next) => (req.body && typeof req.body === 'object' ? next() : jsonParser(req, res, next)));

app.use('/api', async (req, res, next) => {
  if (!pool) return res.status(500).json({ error: 'DATABASE_URL sozlanmagan. Vercel → Storage bo\'limida Neon bazasini ulang.' });
  try { await init(); next(); } catch (e) { next(e); }
});

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- yordamchi ----------
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const intId = (v) => (/^\d+$/.test(String(v ?? '')) ? Number(v) : -1);
const optId = (v) => (v === null || v === undefined || v === '' ? null : intId(v));
const KIND_SECTION = { reading: 'Reading', listening: 'Listening' };
const isHttpUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u);

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!verify(token)) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  next();
}

async function gradeAttempt(attempt, answers) {
  const order = JSON.parse(attempt.question_order);
  const qs = await q('SELECT * FROM questions WHERE id = ANY($1::int[])', [order.map((o) => o.id)]);
  const byId = Object.fromEntries(qs.map((x) => [x.id, x]));
  let score = 0, max = 0;
  const sections = {};
  const review = [];
  for (const o of order) {
    const qq = byId[o.id];
    if (!qq) continue;
    const picked = answers[o.id]; // o'quvchi ko'rgan tartibdagi indeks
    const original = Number.isInteger(picked) ? o.map[picked] ?? null : null;
    const ok = original === qq.correct;
    max += qq.points;
    if (ok) score += qq.points;
    sections[qq.section] ??= { score: 0, max: 0 };
    sections[qq.section].max += qq.points;
    if (ok) sections[qq.section].score += qq.points;
    const opts = JSON.parse(qq.options);
    review.push({
      text: qq.text, section: qq.section, ok,
      picked: original === null ? null : opts[original],
      correct: opts[qq.correct],
    });
  }
  const percent = max ? Math.round((score / max) * 100) : 0;
  return { score, max, percent, sections, review };
}

// ---------- Savollar banki: kvotalar bo'yicha reja ----------
// Har bo'limdan nechta savol olinadi va nechta Reading/Listening bloki tushadi.
// Kvota 0 yoki belgilanmagan bo'lsa — bankdagi hamma savol ishlatiladi.
function buildPlan(test, sections, blocks, quotas) {
  const qmap = Object.fromEntries(quotas.map((x) => [x.section, x.count]));
  const secPlan = sections.map((s) => {
    const quota = Math.max(0, qmap[s.section] || 0);
    return { section: s.section, available: s.available, take: quota > 0 ? Math.min(quota, s.available) : s.available, quota };
  });
  const kindPlan = {};
  for (const kind of ['reading', 'listening']) {
    const list = blocks.filter((b) => b.kind === kind && b.question_count > 0);
    const limit = Math.max(0, test[`${kind}_blocks`] || 0);
    const take = limit > 0 ? Math.min(limit, list.length) : list.length;
    const avgQs = list.length ? list.reduce((a, b) => a + b.question_count, 0) / list.length : 0;
    kindPlan[kind] = { available: list.length, take, limit, questions: Math.round(avgQs * take) };
  }
  const planned = secPlan.reduce((a, s) => a + s.take, 0) + kindPlan.reading.questions + kindPlan.listening.questions;
  const bank = sections.reduce((a, s) => a + s.available, 0) + blocks.reduce((a, b) => a + b.question_count, 0);
  const sampled = secPlan.some((s) => s.take < s.available) ||
    kindPlan.reading.take < kindPlan.reading.available || kindPlan.listening.take < kindPlan.listening.available;
  return { sections: secPlan, blocks: kindPlan, planned, bank, sampled };
}

// Barcha testlar uchun bo'lim/blok statistikasi (bitta so'rovdan)
async function loadPlanData() {
  const [sections, blocks, quotas] = await Promise.all([
    q(`SELECT test_id, section, COUNT(*)::int available, MIN(position) pos FROM questions
       WHERE passage_id IS NULL GROUP BY test_id, section ORDER BY pos`),
    q(`SELECT p.test_id, p.id, p.kind, COUNT(qq.id)::int question_count FROM passages p
       LEFT JOIN questions qq ON qq.passage_id = p.id GROUP BY p.id ORDER BY p.position, p.id`),
    q('SELECT * FROM section_quotas'),
  ]);
  const by = (rows) => rows.reduce((m, r) => ((m[r.test_id] ??= []).push(r), m), {});
  return { sections: by(sections), blocks: by(blocks), quotas: by(quotas) };
}
const planFor = (test, data) => buildPlan(test, data.sections[test.id] || [], data.blocks[test.id] || [], data.quotas[test.id] || []);

// ---------- O'QUVCHI API ----------
app.get('/api/tests', h(async (req, res) => {
  const [rows, data] = await Promise.all([
    q(`SELECT id, title, level_from, level_to, description, duration_min, pass_percent, max_violations, reading_blocks, listening_blocks
       FROM tests WHERE active ORDER BY level_from, id`),
    loadPlanData(),
  ]);
  res.json(rows.map((t) => {
    const p = planFor(t, data);
    return { ...t, question_count: p.planned, sampled: p.sampled };
  }).filter((t) => t.question_count > 0));
}));

// Ustozlar va guruhlar ro'yxati (o'quvchi formasi uchun)
app.get('/api/directory', h(async (req, res) => {
  const [teachers, groups] = await Promise.all([
    q('SELECT id, name FROM teachers WHERE active ORDER BY name'),
    q('SELECT id, name, teacher_id FROM study_groups WHERE active ORDER BY name'),
  ]);
  res.json({ teachers, groups });
}));

app.post('/api/attempts', h(async (req, res) => {
  const b = req.body;
  const name = clean(b.student_name, 100);
  const phone = clean(b.phone, 30);
  if (name.length < 3) return res.status(400).json({ error: 'Ism-familiyani to\'liq kiriting' });
  if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Telefon raqamni to\'g\'ri kiriting' });
  const test = await one('SELECT * FROM tests WHERE id = $1 AND active', [intId(b.test_id)]);
  if (!test) return res.status(404).json({ error: 'Test topilmadi' });

  // Ustoz va guruh: ro'yxat mavjud bo'lsa, faqat ro'yxatdan tanlanadi
  let teacherId = null, groupId = null;
  let teacherName = clean(b.teacher, 60), groupName = clean(b.group_name, 60);
  const counts = await one(`SELECT (SELECT COUNT(*) FROM teachers WHERE active) t, (SELECT COUNT(*) FROM study_groups WHERE active) g`);
  if (counts.t > 0) {
    const t = await one('SELECT id, name FROM teachers WHERE id = $1 AND active', [intId(b.teacher_id)]);
    if (!t) return res.status(400).json({ error: 'Ustozingizni ro\'yxatdan tanlang' });
    teacherId = t.id; teacherName = t.name;
  }
  if (counts.g > 0) {
    const g = await one('SELECT id, name, teacher_id FROM study_groups WHERE id = $1 AND active', [intId(b.group_id)]);
    if (!g) return res.status(400).json({ error: 'Guruhingizni ro\'yxatdan tanlang' });
    if (teacherId && g.teacher_id && g.teacher_id !== teacherId) return res.status(400).json({ error: 'Bu guruh tanlangan ustozga tegishli emas' });
    groupId = g.id; groupName = g.name;
  }

  const [allQs, passages, quotas] = await Promise.all([
    q('SELECT * FROM questions WHERE test_id = $1 ORDER BY position, id', [test.id]),
    q('SELECT * FROM passages WHERE test_id = $1 ORDER BY position, id', [test.id]),
    q('SELECT section, count FROM section_quotas WHERE test_id = $1', [test.id]),
  ]);
  if (!allQs.length) return res.status(400).json({ error: 'Bu testda savollar yo\'q' });

  // Bankdan tanlov: har bo'limdan kvota bo'yicha tasodifiy savollar
  const mix = (arr) => (test.shuffle ? shuffle(arr) : arr);
  const quota = Object.fromEntries(quotas.map((x) => [x.section, x.count]));
  const standaloneAll = allQs.filter((x) => !x.passage_id);
  const sectionOrder = [...new Set(standaloneAll.map((x) => x.section))];
  const standalone = sectionOrder.flatMap((section) => {
    const pool = standaloneAll.filter((x) => x.section === section);
    const take = quota[section] > 0 ? Math.min(quota[section], pool.length) : pool.length;
    // Kvota bo'lsa — har doim tasodifiy tanlanadi (aralashtirish o'chiq bo'lsa ham)
    return (take < pool.length ? shuffle(pool).slice(0, take) : mix(pool));
  });

  // Reading/Listening bloklari: belgilangan sonda tasodifiy tanlanadi
  const usedPassages = [];
  for (const kind of ['reading', 'listening']) {
    const pool = passages.filter((p) => p.kind === kind && allQs.some((x) => x.passage_id === p.id));
    const limit = Math.max(0, test[`${kind}_blocks`] || 0);
    const picked = limit > 0 && limit < pool.length ? shuffle(pool).slice(0, limit) : pool;
    usedPassages.push(...picked.sort((a, b) => a.position - b.position || a.id - b.id));
  }
  const ordered = [...standalone, ...usedPassages.flatMap((p) => mix(allQs.filter((x) => x.passage_id === p.id)))];
  if (!ordered.length) return res.status(400).json({ error: 'Bu testda savollar yo\'q' });

  const order = [];
  const payload = ordered.map((qq) => {
    const opts = JSON.parse(qq.options);
    const map = mix(opts.map((_, i) => i));
    order.push({ id: qq.id, map });
    return { id: qq.id, passage_id: qq.passage_id, section: qq.section, text: qq.text, points: qq.points, options: map.map((i) => opts[i]) };
  });

  const id = crypto.randomUUID();
  const now = Date.now();
  const deadline = now + test.duration_min * 60 * 1000;
  await q(`INSERT INTO attempts (id, test_id, student_name, phone, group_name, teacher, teacher_id, group_id, question_order, started_at, deadline)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, test.id, name, phone, groupName, teacherName, teacherId, groupId, JSON.stringify(order), now, deadline]);

  res.json({
    attempt_id: id,
    test: { title: test.title, level_from: test.level_from, level_to: test.level_to, max_violations: test.max_violations },
    deadline, server_now: now,
    passages: usedPassages.map((p) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, audio_url: p.audio_url, max_plays: p.max_plays })),
    questions: payload,
  });
}));

// Oynadan chiqish va boshqa shubhali hodisalarni qayd qilish
const EVENT_TYPES = { hidden: 'Boshqa oyna/ilovaga o\'tdi', blur: 'Test oynasidan chiqdi', fullscreen_exit: 'To\'liq ekrandan chiqdi' };
app.post('/api/attempts/:id/event', h(async (req, res) => {
  const type = String(req.body.type || '');
  if (!EVENT_TYPES[type]) return res.status(400).json({ error: 'Noma\'lum hodisa' });
  const row = await one(`
    UPDATE attempts a SET violations = a.violations + 1,
      events = CASE WHEN jsonb_array_length(a.events::jsonb) < $3
                    THEN (a.events::jsonb || jsonb_build_array(jsonb_build_object('t', $2::bigint, 'type', $1::text)))::text
                    ELSE a.events END
    FROM tests t
    WHERE a.id = $4 AND a.finished_at IS NULL AND t.id = a.test_id
    RETURNING a.violations, t.max_violations`, [type, Date.now(), MAX_EVENTS_LOGGED, req.params.id]);
  if (!row) return res.status(409).json({ error: 'Test yakunlangan' });
  res.json({ violations: row.violations, max: row.max_violations });
}));

app.post('/api/attempts/:id/submit', h(async (req, res) => {
  const now = Date.now();
  // Bir vaqtda ikki marta topshirishning oldini olish: faqat birinchi so'rov "egallaydi"
  const attempt = await one('UPDATE attempts SET finished_at = $1 WHERE id = $2 AND finished_at IS NULL RETURNING *', [now, req.params.id]);
  if (!attempt) {
    const exists = await one('SELECT 1 FROM attempts WHERE id = $1', [req.params.id]);
    return exists ? res.status(409).json({ error: 'Bu test allaqachon topshirilgan' }) : res.status(404).json({ error: 'Urinish topilmadi' });
  }
  const test = await one('SELECT * FROM tests WHERE id = $1', [attempt.test_id]);

  const late = now > attempt.deadline + GRACE_SECONDS * 1000;
  const answers = late ? {} : (req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {});
  const g = await gradeAttempt(attempt, answers);
  const passed = g.percent >= test.pass_percent;

  let reason = ['time', 'violations', 'manual'].includes(req.body.reason) ? req.body.reason : 'manual';
  if (test.max_violations > 0 && attempt.violations >= test.max_violations) reason = 'violations';
  if (late) reason = 'time';

  await q(`UPDATE attempts SET answers=$1, score=$2, max_score=$3, percent=$4, passed=$5, sections=$6, finish_reason=$7 WHERE id=$8`,
    [JSON.stringify(answers), g.score, g.max, g.percent, passed, JSON.stringify(g.sections), reason, attempt.id]);

  res.json({
    student_name: attempt.student_name,
    test: { title: test.title, level_from: test.level_from, level_to: test.level_to, pass_percent: test.pass_percent },
    score: g.score, max: g.max, percent: g.percent, passed, late, reason,
    violations: attempt.violations,
    duration_sec: Math.round((now - attempt.started_at) / 1000),
    sections: g.sections,
    review: test.show_answers ? g.review : null,
  });
}));

// ---------- ADMIN API ----------
app.post('/api/admin/login', (req, res) => {
  const pw = String(req.body?.password || '');
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Parol noto\'g\'ri' });
  res.json({ token: sign({ role: 'admin', exp: Date.now() + 12 * 3600 * 1000 }) });
});

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/config', (req, res) => res.json({ blob: !!process.env.BLOB_READ_WRITE_TOKEN }));

admin.get('/stats', h(async (req, res) => {
  res.json(await one(`
    SELECT (SELECT COUNT(*) FROM tests) tests,
           (SELECT COUNT(*) FROM questions) questions,
           (SELECT COUNT(*) FROM attempts WHERE score IS NOT NULL) attempts,
           (SELECT COUNT(*) FROM attempts WHERE passed) passed,
           (SELECT COUNT(*) FROM attempts WHERE score IS NOT NULL AND violations > 0) flagged,
           (SELECT COALESCE(ROUND(AVG(percent)), 0)::int FROM attempts WHERE score IS NOT NULL) avg`));
}));

// --- Ustozlar ---
admin.get('/teachers', h(async (req, res) => {
  res.json(await q(`SELECT t.*, (SELECT COUNT(*) FROM study_groups g WHERE g.teacher_id = t.id) group_count
                    FROM teachers t ORDER BY t.active DESC, t.name`));
}));
admin.post('/teachers', h(async (req, res) => {
  const names = String(req.body.names ?? req.body.name ?? '').split('\n').map((s) => clean(s, 80)).filter(Boolean);
  if (!names.length) return res.status(400).json({ error: 'Ustoz ismini kiriting' });
  await tx(async (c) => { for (const n of names) await c.query('INSERT INTO teachers (name) VALUES ($1)', [n]); });
  res.json({ added: names.length });
}));
admin.put('/teachers/:id', h(async (req, res) => {
  const name = clean(req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Ustoz ismini kiriting' });
  await q('UPDATE teachers SET name=$1, active=$2 WHERE id=$3', [name, req.body.active !== false, intId(req.params.id)]);
  res.json({ ok: true });
}));
admin.delete('/teachers/:id', h(async (req, res) => {
  await q('DELETE FROM teachers WHERE id=$1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

// --- Guruhlar ---
admin.get('/groups', h(async (req, res) => {
  res.json(await q(`SELECT g.*, t.name teacher_name FROM study_groups g LEFT JOIN teachers t ON t.id = g.teacher_id
                    ORDER BY g.active DESC, g.name`));
}));
admin.post('/groups', h(async (req, res) => {
  const names = String(req.body.names ?? req.body.name ?? '').split('\n').map((s) => clean(s, 60)).filter(Boolean);
  if (!names.length) return res.status(400).json({ error: 'Guruh nomini kiriting' });
  const teacherId = optId(req.body.teacher_id);
  await tx(async (c) => {
    for (const n of names) await c.query('INSERT INTO study_groups (name, teacher_id) VALUES ($1,$2)', [n, teacherId]);
  });
  res.json({ added: names.length });
}));
admin.put('/groups/:id', h(async (req, res) => {
  const name = clean(req.body.name, 60);
  if (!name) return res.status(400).json({ error: 'Guruh nomini kiriting' });
  await q('UPDATE study_groups SET name=$1, teacher_id=$2, active=$3 WHERE id=$4',
    [name, optId(req.body.teacher_id), req.body.active !== false, intId(req.params.id)]);
  res.json({ ok: true });
}));
admin.delete('/groups/:id', h(async (req, res) => {
  await q('DELETE FROM study_groups WHERE id=$1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

// --- Testlar ---
admin.get('/tests', h(async (req, res) => {
  const [rows, data] = await Promise.all([
    q(`SELECT t.*, (SELECT COUNT(*) FROM questions qq WHERE qq.test_id=t.id) question_count,
        (SELECT COUNT(*) FROM passages p WHERE p.test_id=t.id) passage_count,
        (SELECT COUNT(*) FROM attempts a WHERE a.test_id=t.id AND a.score IS NOT NULL) attempt_count
       FROM tests t ORDER BY t.level_from, t.id`),
    loadPlanData(),
  ]);
  res.json(rows.map((t) => {
    const p = planFor(t, data);
    return { ...t, planned_count: p.planned, sampled: p.sampled };
  }));
}));
const testFields = (b) => [
  clean(b.title, 150), clean(b.level_from, 10), clean(b.level_to, 10), clean(b.description, 500),
  Math.max(1, Math.min(300, parseInt(b.duration_min) || 40)),
  Math.max(0, Math.min(100, parseInt(b.pass_percent) || 0)),
  !!b.shuffle, !!b.show_answers, !!b.active,
  Math.max(0, Math.min(20, parseInt(b.max_violations) || 0)),
];
admin.post('/tests', h(async (req, res) => {
  const f = testFields(req.body);
  if (!f[0]) return res.status(400).json({ error: 'Test nomini kiriting' });
  const r = await one(`INSERT INTO tests (title, level_from, level_to, description, duration_min, pass_percent, shuffle, show_answers, active, max_violations)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, f);
  res.json({ id: r.id });
}));
admin.put('/tests/:id', h(async (req, res) => {
  const f = testFields(req.body);
  if (!f[0]) return res.status(400).json({ error: 'Test nomini kiriting' });
  await q(`UPDATE tests SET title=$1, level_from=$2, level_to=$3, description=$4, duration_min=$5, pass_percent=$6,
           shuffle=$7, show_answers=$8, active=$9, max_violations=$10 WHERE id=$11`, [...f, intId(req.params.id)]);
  res.json({ ok: true });
}));
admin.delete('/tests/:id', h(async (req, res) => {
  await q('DELETE FROM tests WHERE id=$1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

// --- Test tarkibi: matn/audio bloklari + savollar ---
admin.get('/tests/:id/content', h(async (req, res) => {
  const id = intId(req.params.id);
  const [test, passages, questions, quotas] = await Promise.all([
    one('SELECT * FROM tests WHERE id=$1', [id]),
    q('SELECT * FROM passages WHERE test_id=$1 ORDER BY position, id', [id]),
    q('SELECT * FROM questions WHERE test_id=$1 ORDER BY position, id', [id]),
    q('SELECT section, count FROM section_quotas WHERE test_id=$1', [id]),
  ]);
  if (!test) return res.status(404).json({ error: 'Test topilmadi' });
  const sections = [];
  for (const x of questions.filter((y) => !y.passage_id)) {
    const s = sections.find((y) => y.section === x.section);
    s ? s.available++ : sections.push({ section: x.section, available: 1 });
  }
  const blocks = passages.map((p) => ({ ...p, kind: p.kind, question_count: questions.filter((x) => x.passage_id === p.id).length }));
  res.json({
    test, passages, quotas,
    questions: questions.map((x) => ({ ...x, options: JSON.parse(x.options) })),
    plan: buildPlan(test, sections, blocks, quotas),
  });
}));

// Bankdan nechta savol tushishini belgilash
admin.put('/tests/:id/plan', h(async (req, res) => {
  const id = intId(req.params.id);
  const num = (v) => Math.max(0, Math.min(1000, parseInt(v) || 0));
  const sections = req.body.sections && typeof req.body.sections === 'object' ? req.body.sections : {};
  await tx(async (c) => {
    await c.query('UPDATE tests SET reading_blocks=$1, listening_blocks=$2 WHERE id=$3',
      [num(req.body.reading_blocks), num(req.body.listening_blocks), id]);
    await c.query('DELETE FROM section_quotas WHERE test_id=$1', [id]);
    for (const [section, count] of Object.entries(sections)) {
      const n = num(count);
      if (n > 0) await c.query('INSERT INTO section_quotas (test_id, section, count) VALUES ($1,$2,$3)', [id, clean(section, 40), n]);
    }
  });
  res.json({ ok: true });
}));

function validPassage(b) {
  const kind = b.kind === 'listening' ? 'listening' : 'reading';
  const body = clean(b.body, 20000);
  const audio = clean(b.audio_url, 1000);
  if (kind === 'reading' && !body) return { error: 'O\'qish matnini kiriting' };
  if (kind === 'listening' && !audio) return { error: 'Audio faylni yuklang yoki havolasini kiriting' };
  if (audio && !isHttpUrl(audio)) return { error: 'Audio havolasi http(s):// bilan boshlanishi kerak' };
  return { v: [kind, clean(b.title, 200), body, audio, Math.max(0, Math.min(10, parseInt(b.max_plays) || 0))] };
}
admin.post('/tests/:id/passages', h(async (req, res) => {
  const v = validPassage(req.body);
  if (v.error) return res.status(400).json(v);
  const testId = intId(req.params.id);
  const r = await one(`INSERT INTO passages (kind, title, body, audio_url, max_plays, test_id, position)
    VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(position),0)+1 FROM passages WHERE test_id=$6)) RETURNING id`, [...v.v, testId]);
  res.json({ id: r.id });
}));
admin.put('/passages/:id', h(async (req, res) => {
  const v = validPassage(req.body);
  if (v.error) return res.status(400).json(v);
  const id = intId(req.params.id);
  await tx(async (c) => {
    await c.query('UPDATE passages SET kind=$1, title=$2, body=$3, audio_url=$4, max_plays=$5 WHERE id=$6', [...v.v, id]);
    await c.query('UPDATE questions SET section=$1 WHERE passage_id=$2', [KIND_SECTION[v.v[0]], id]);
  });
  res.json({ ok: true });
}));
admin.delete('/passages/:id', h(async (req, res) => {
  await q('DELETE FROM passages WHERE id=$1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

async function resolvePassage(testId, passageId) {
  if (passageId === null) return { passage: null };
  const p = await one('SELECT id, kind FROM passages WHERE id=$1 AND test_id=$2', [passageId, testId]);
  return p ? { passage: p } : { error: 'Matn/audio bloki topilmadi' };
}
function validQuestion(b) {
  const options = (Array.isArray(b.options) ? b.options : []).map((o) => clean(o, 500)).filter(Boolean);
  const correct = parseInt(b.correct);
  if (!clean(b.text, 3000)) return { error: 'Savol matnini kiriting' };
  if (options.length < 2) return { error: 'Kamida 2 ta variant kerak' };
  if (!(correct >= 0 && correct < options.length)) return { error: 'To\'g\'ri javobni belgilang' };
  return { section: clean(b.section, 40) || 'Grammar', text: clean(b.text, 3000), options: JSON.stringify(options), correct, points: Math.max(1, parseInt(b.points) || 1) };
}
admin.post('/tests/:id/questions', h(async (req, res) => {
  const v = validQuestion(req.body);
  if (v.error) return res.status(400).json(v);
  const testId = intId(req.params.id);
  const p = await resolvePassage(testId, optId(req.body.passage_id));
  if (p.error) return res.status(400).json(p);
  const section = p.passage ? KIND_SECTION[p.passage.kind] : v.section;
  const r = await one(`INSERT INTO questions (section, text, options, correct, points, passage_id, test_id, position)
    VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(MAX(position),0)+1 FROM questions WHERE test_id=$7)) RETURNING id`,
    [section, v.text, v.options, v.correct, v.points, p.passage?.id ?? null, testId]);
  res.json({ id: r.id });
}));
admin.put('/questions/:id', h(async (req, res) => {
  const v = validQuestion(req.body);
  if (v.error) return res.status(400).json(v);
  const cur = await one('SELECT test_id FROM questions WHERE id=$1', [intId(req.params.id)]);
  if (!cur) return res.status(404).json({ error: 'Savol topilmadi' });
  const p = await resolvePassage(cur.test_id, optId(req.body.passage_id));
  if (p.error) return res.status(400).json(p);
  const section = p.passage ? KIND_SECTION[p.passage.kind] : v.section;
  await q('UPDATE questions SET section=$1, text=$2, options=$3, correct=$4, points=$5, passage_id=$6 WHERE id=$7',
    [section, v.text, v.options, v.correct, v.points, p.passage?.id ?? null, intId(req.params.id)]);
  res.json({ ok: true });
}));
admin.delete('/questions/:id', h(async (req, res) => {
  await q('DELETE FROM questions WHERE id=$1', [intId(req.params.id)]);
  res.json({ ok: true });
}));

// Ommaviy import (matn formatida), ixtiyoriy ravishda bitta blokka biriktiriladi
admin.post('/tests/:id/import', h(async (req, res) => {
  const { parsed, errors } = parseBulk(String(req.body.text || ''));
  if (errors.length) return res.status(400).json({ error: errors.join('\n') });
  if (!parsed.length) return res.status(400).json({ error: 'Savol topilmadi' });
  const testId = intId(req.params.id);
  const p = await resolvePassage(testId, optId(req.body.passage_id));
  if (p.error) return res.status(400).json(p);
  await tx(async (c) => {
    let { rows: [{ pos }] } = await c.query('SELECT COALESCE(MAX(position),0) pos FROM questions WHERE test_id=$1', [testId]);
    for (const x of parsed) {
      await c.query('INSERT INTO questions (test_id, section, text, options, correct, points, passage_id, position) VALUES ($1,$2,$3,$4,$5,1,$6,$7)',
        [testId, p.passage ? KIND_SECTION[p.passage.kind] : x.section, x.text, JSON.stringify(x.options), x.correct, p.passage?.id ?? null, ++pos]);
    }
  });
  res.json({ added: parsed.length });
}));

// Format:
// [Grammar]
// 1. She ___ to school every day.
// a) go
// *b) goes
function parseBulk(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  const parsed = [], errors = [];
  let section = 'Grammar';
  blocks.forEach((block, bi) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (/^\[.+\]$/.test(lines[0])) section = lines.shift().slice(1, -1).trim();
    if (!lines.length) return;
    const qText = lines[0].replace(/^\d+[.)]\s*/, '');
    const options = []; let correct = -1;
    for (const l of lines.slice(1)) {
      const m = l.match(/^(\*?)\s*[a-hA-H][.)]\s*(.+)$/);
      if (!m) continue;
      if (m[1]) correct = options.length;
      options.push(m[2].trim());
    }
    if (options.length < 2) errors.push(`${bi + 1}-blok: variantlar topilmadi — "${qText.slice(0, 40)}"`);
    else if (correct < 0) errors.push(`${bi + 1}-blok: to'g'ri javob * bilan belgilanmagan — "${qText.slice(0, 40)}"`);
    else parsed.push({ section, text: qText, options, correct });
  });
  return { parsed, errors };
}

// --- Audio yuklash (Vercel Blob) ---
admin.post('/blob-upload', h(async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(400).json({ error: 'Fayl saqlash (Vercel Blob) ulanmagan' });
  const { handleUpload } = require('@vercel/blob/client');
  const result = await handleUpload({
    body: req.body,
    request: req,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm'],
      maximumSizeInBytes: 60 * 1024 * 1024,
      addRandomSuffix: true,
    }),
  });
  res.json(result);
}));

// --- Natijalar ---
async function resultsQuery(f) {
  const where = ['a.score IS NOT NULL'], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.test_id) add('a.test_id = ?', intId(f.test_id));
  if (f.teacher_id) add('a.teacher_id = ?', intId(f.teacher_id));
  if (f.group_id) add('a.group_id = ?', intId(f.group_id));
  if (f.status === 'passed') where.push('a.passed');
  if (f.status === 'failed') where.push('NOT a.passed');
  if (f.status === 'flagged') where.push('a.violations > 0');
  if (f.search) {
    params.push(`%${f.search}%`);
    const n = `$${params.length}`;
    where.push(`(a.student_name ILIKE ${n} OR a.phone ILIKE ${n} OR a.group_name ILIKE ${n} OR a.teacher ILIKE ${n})`);
  }
  const day = (s) => Date.parse(`${s}T00:00:00+05:00`); // Toshkent vaqti
  if (f.from && !isNaN(day(f.from))) add('a.finished_at >= ?', day(f.from));
  if (f.to && !isNaN(day(f.to))) add('a.finished_at < ?', day(f.to) + 86400000);
  return q(`
    SELECT a.id, a.student_name, a.phone, a.group_name, a.teacher, a.started_at, a.finished_at,
           a.score, a.max_score, a.percent, a.passed, a.sections, a.violations, a.finish_reason,
           t.title, t.level_from, t.level_to
    FROM attempts a JOIN tests t ON t.id = a.test_id
    WHERE ${where.join(' AND ')} ORDER BY a.finished_at DESC LIMIT 2000`, params);
}
const REASON = { manual: "O'quvchi yakunladi", time: 'Vaqt tugadi', violations: 'Qoidabuzarlik sababli' };
admin.get('/results', h(async (req, res) => {
  const rows = await resultsQuery(req.query);
  res.json(rows.map((r) => ({ ...r, sections: JSON.parse(r.sections || '{}') })));
}));
admin.get('/results.csv', h(async (req, res) => {
  const rows = await resultsQuery(req.query);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const fmt = (ms) => new Date(ms).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
  const lines = [['Sana', 'F.I.Sh', 'Telefon', 'Guruh', 'Ustoz', 'Test', 'Daraja', 'Ball', 'Foiz', 'Natija',
    'Vaqt (daq)', 'Oynadan chiqish', 'Yakunlanish'].map(esc).join(',')];
  for (const r of rows) {
    lines.push([fmt(r.finished_at), r.student_name, r.phone, r.group_name, r.teacher, r.title,
      `${r.level_from}→${r.level_to}`, `${r.score}/${r.max_score}`, `${r.percent}%`,
      r.passed ? "O'tdi" : "O'tmadi", Math.round((r.finished_at - r.started_at) / 60000),
      r.violations, REASON[r.finish_reason] || ''].map(esc).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="natijalar.csv"');
  res.send('﻿' + lines.join('\n'));
}));
admin.get('/results/:id', h(async (req, res) => {
  const a = await one('SELECT * FROM attempts WHERE id=$1 AND score IS NOT NULL', [req.params.id]);
  if (!a) return res.status(404).json({ error: 'Topilmadi' });
  const g = await gradeAttempt(a, JSON.parse(a.answers || '{}'));
  const events = JSON.parse(a.events || '[]').map((e) => ({ ...e, label: EVENT_TYPES[e.type] || e.type }));
  res.json({ ...a, question_order: undefined, answers: undefined, review: g.review, sections: g.sections, events });
}));
admin.delete('/results/:id', h(async (req, res) => {
  await q('DELETE FROM attempts WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.use('/api/admin', admin);

// AI Speaking moduli
require('./speaking')(app, { q, one, tx, h, clean, intId, optId, shuffle, requireAdmin });

app.use('/api', (req, res) => res.status(404).json({ error: 'Topilmadi' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server xatosi. Birozdan keyin qayta urinib ko\'ring.' });
});

module.exports = app;
