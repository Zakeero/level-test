// AI Speaking — IELTS uslubidagi og'zaki imtihon (Gemini bilan baholanadi)
const crypto = require('crypto');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
// Bepul tarifda model vaqtincha band bo'lishi mumkin (503) — shunda zaxira model sinab ko'riladi
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || '';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = () => process.env.GEMINI_API_KEY || '';
const RETRY_STATUS = [408, 429, 500, 502, 503, 504];
const RETRY_DELAYS = [700, 1800, 3500]; // urinishlar orasidagi kutish (ms)
// Haqiqiy IELTS Speaking tartibi: har bir bosqich uchun vaqt qoidalari (soniyalarda)
//   grace   — savoldan keyin gapirishni boshlash uchun beriladigan vaqt
//   silence — shuncha jim tursa, javob tugagan deb hisoblanadi
//   max     — bitta javobning eng uzun davomiyligi
//   budget  — butun qismning umumiy vaqti (tugasa, keyingi qismga o'tiladi)
//   think   — savoldan keyin o'ylash uchun beriladigan vaqt (shu vaqt ichida gapirmasa, savol takrorlanadi)
//   silence — gapirib bo'lgach shuncha jim tursa, javob tugagan deb hisoblanadi
//   max     — javobning eng uzun davomiyligi (gapirish boshlangan paytdan hisoblanadi)
// Standart sozlamalar. Admin panelda o'zgartirilsa, speak_config jadvalidan olinadi.
const DEFAULTS = {
  timings: {
    0: { prep: 0, think: 8, silence: 3, max: 25, label: 'Tanishuv' },         // salomlashuv, baholanmaydi
    1: { prep: 0, think: 10, silence: 3, max: 30, label: 'Part 1' },
    2: { prep: 60, think: 10, silence: 5, max: 120, min: 45, label: 'Part 2' },
    3: { prep: 0, think: 10, silence: 3, max: 30, label: 'Part 3' },
  },
  budget: { 1: 240, 3: 240 },           // qism uchun umumiy chegara (savollar tugamasa ham o'tiladi)
  counts: { p1_topics: 2, p1_per_topic: 2, p3_min: 3, p3_max: 4 },
  roundoff_max: 2,                      // Part 2 dan keyingi qo'shimcha savollar soni
  short_answer_sec: 15,                 // bundan qisqa Part 3 javobi — "tell me more"
  texts: {
    intro: [
      'Good morning. My name is Alex, and I will be your examiner today. Could you tell me your full name, please?',
      'Thank you. And where are you from?',
    ],
    part2_start: 'All right. Remember you have one to two minutes. Please start speaking now.',
    part2_nudge: 'Is that everything you would like to say?',
    thanks: 'Thank you.',
    probe: 'Could you tell me a bit more about that?',
    roundoff_fallback: 'How did you feel about that experience?',
    closing: 'Thank you. That is the end of the speaking test.',
  },
};
const num = (v, def, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
// Saqlangan sozlamalarni standart qiymatlar ustiga qo'yamiz (noto'g'ri qiymatlar chetga suriladi)
function mergeConfig(saved) {
  const d = DEFAULTS, s = saved || {};
  const t = {}, st = s.timings || {};
  for (const p of [0, 1, 2, 3]) {
    const dp = d.timings[p], sp = st[p] || st[String(p)] || {};
    t[p] = {
      label: dp.label,
      prep: num(sp.prep, dp.prep, 0, 300),
      think: num(sp.think, dp.think, 0, 120),
      silence: num(sp.silence, dp.silence, 1, 30),
      max: num(sp.max, dp.max, 10, 600),
      ...(dp.min !== undefined ? { min: num(sp.min, dp.min, 0, 600) } : {}),
    };
  }
  const c = s.counts || {}, b = s.budget || {}, x = s.texts || {};
  const text = (v, def) => (typeof v === 'string' && v.trim() ? clean0(v, 400) : def);
  return {
    timings: t,
    budget: { 1: num(b[1] ?? b['1'], d.budget[1], 60, 1800), 3: num(b[3] ?? b['3'], d.budget[3], 60, 1800) },
    counts: {
      p1_topics: num(c.p1_topics, d.counts.p1_topics, 1, 5),
      p1_per_topic: num(c.p1_per_topic, d.counts.p1_per_topic, 1, 8),
      p3_min: num(c.p3_min, d.counts.p3_min, 1, 10),
      p3_max: num(c.p3_max, d.counts.p3_max, 1, 10),
    },
    roundoff_max: num(s.roundoff_max, d.roundoff_max, 0, 4),
    short_answer_sec: num(s.short_answer_sec, d.short_answer_sec, 0, 120),
    texts: {
      intro: Array.isArray(x.intro) && x.intro.filter((l) => String(l || '').trim()).length
        ? x.intro.filter((l) => String(l || '').trim()).slice(0, 4).map((l) => clean0(l, 400))
        : d.texts.intro,
      part2_start: text(x.part2_start, d.texts.part2_start),
      part2_nudge: text(x.part2_nudge, d.texts.part2_nudge),
      thanks: text(x.thanks, d.texts.thanks),
      probe: text(x.probe, d.texts.probe),
      roundoff_fallback: text(x.roundoff_fallback, d.texts.roundoff_fallback),
      closing: text(x.closing, d.texts.closing),
    },
  };
}
const clean0 = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const AUDIO_MIMES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS speak_topics (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS speak_items (
    id SERIAL PRIMARY KEY,
    topic_id INT NOT NULL REFERENCES speak_topics(id) ON DELETE CASCADE,
    part INT NOT NULL,                 -- 1 | 2 | 3
    text TEXT NOT NULL,
    bullets TEXT NOT NULL DEFAULT '',  -- Part 2 kartochkasi uchun
    position INT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS speak_sessions (
    id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    teacher TEXT DEFAULT '',
    group_name TEXT DEFAULT '',
    teacher_id INT,
    group_id INT,
    plan TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT,
    result TEXT,
    overall_band NUMERIC(3,1),
    cefr TEXT DEFAULT '',
    model TEXT DEFAULT '',
    teacher_band NUMERIC(3,1),
    teacher_note TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS speak_answers (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES speak_sessions(id) ON DELETE CASCADE,
    idx INT NOT NULL,
    part INT NOT NULL,
    question TEXT NOT NULL,
    audio_url TEXT DEFAULT '',
    duration_sec INT DEFAULT 0,
    transcript TEXT DEFAULT '',
    analysis TEXT DEFAULT '',
    created_at BIGINT NOT NULL,
    UNIQUE (session_id, idx)
  );
  -- Kirish kodlari: tashqaridan kelganlar naqd to'lagach shu koddan oladi
  CREATE TABLE IF NOT EXISTS speak_codes (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    note TEXT NOT NULL DEFAULT '',
    max_uses INT NOT NULL DEFAULT 1,
    used INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at BIGINT,
    created_at BIGINT NOT NULL
  );
  ALTER TABLE speak_sessions
    ADD COLUMN IF NOT EXISTS student_type TEXT NOT NULL DEFAULT 'registon',
    ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
  -- Imtihon sozlamalari (vaqtlar, savollar soni, AI aytadigan matnlar) — admin paneldan boshqariladi
  CREATE TABLE IF NOT EXISTS speak_config (
    id INT PRIMARY KEY DEFAULT 1,
    data TEXT NOT NULL DEFAULT '{}',
    updated_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_sc_code ON speak_codes(code);
  CREATE INDEX IF NOT EXISTS idx_si_topic ON speak_items(topic_id);
  CREATE INDEX IF NOT EXISTS idx_sa_session ON speak_answers(session_id);
  CREATE INDEX IF NOT EXISTS idx_ss_finished ON speak_sessions(finished_at);
`;

// ---------- Gemini ----------
async function geminiOnce(model, body, timeoutMs) {
  const r = await fetch(`${API}/${model}:generateContent?key=${KEY()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Gemini ${r.status}: ${(d.error?.message || '').slice(0, 200)}`);
    e.status = r.status;
    e.retryable = RETRY_STATUS.includes(r.status);
    throw e;
  }
  return d?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '';
}

// Bir necha marta urinadi: 503/429 kabi vaqtinchalik xatolarda kutib qayta so'raydi,
// keyin (agar sozlangan bo'lsa) zaxira modelga o'tadi.
async function gemini(parts, { json = true, temperature = 0.2, timeoutMs = 25_000 } = {}) {
  if (!KEY()) throw new Error('GEMINI_API_KEY sozlanmagan');
  const body = {
    contents: [{ parts }],
    generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  const chain = FALLBACK_MODEL
    ? [MODEL, MODEL, FALLBACK_MODEL, MODEL, FALLBACK_MODEL, MODEL]
    : [MODEL, MODEL, MODEL, MODEL];
  const deadline = Date.now() + 48_000; // serverless funksiya chegarasidan (60s) oshib ketmaslik uchun
  const dead = new Set();               // shu so'rov davomida ishlamaydigan modellar (404/400)
  let last, waits = 0;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    if (dead.has(model) || Date.now() > deadline) { if (Date.now() > deadline) break; continue; }
    try {
      const text = await geminiOnce(model, body, timeoutMs);
      if (!text) throw Object.assign(new Error('Gemini bo\'sh javob qaytardi'), { retryable: true });
      if (!json) return text;
      try { return JSON.parse(text); } catch { throw Object.assign(new Error('Gemini javobini o\'qib bo\'lmadi'), { retryable: true }); }
    } catch (e) {
      last = e;
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      if (!e.retryable && !timedOut) {
        // 404/400 — shu model yaroqsiz: uni chetga surib, zanjirdagi boshqasi bilan davom etamiz
        if (e.status === 404 || e.status === 400) {
          dead.add(model);
          if (chain.slice(i + 1).some((m) => !dead.has(m))) continue;
        }
        throw e;                                            // 401/403 va boshqalar — qayta urinishdan foyda yo'q
      }
      if (Date.now() > deadline || !chain.slice(i + 1).some((m) => !dead.has(m))) break;
      await new Promise((s) => setTimeout(s, RETRY_DELAYS[Math.min(waits++, RETRY_DELAYS.length - 1)]));
    }
  }
  throw last;
}

const INTRO_PROMPT = (question) => `You are a certified IELTS Speaking examiner running the short introduction
before the test proper. You asked: "${question}"

Transcribe exactly what the candidate said. This part is NOT scored.
Return JSON only, no markdown:
{ "transcript": "exact words the candidate said", "word_count": number, "too_short": true/false }`;

const ANSWER_PROMPT = (part, question, grade = true) => (!grade ? INTRO_PROMPT(question) : `You are a certified IELTS Speaking examiner.
The candidate is answering IELTS Speaking Part ${part} question: "${question}"

Listen to the recording carefully and assess it against the official IELTS Speaking band descriptors.
Judge pronunciation from the audio itself (individual sounds, word stress, sentence stress, intonation, intelligibility).
If the recording is empty, silent or unintelligible, set every band to 0 and say so in the notes.

Return JSON only, no markdown:
{
  "transcript": "exact words the candidate said, with natural punctuation",
  "word_count": number,
  "bands": { "fluency": number, "lexical": number, "grammar": number, "pronunciation": number },
  "notes": { "fluency": "one sentence", "lexical": "one sentence", "grammar": "one sentence", "pronunciation": "one sentence" },
  "errors": [ { "said": "what the candidate said", "better": "corrected version", "type": "grammar | vocabulary | pronunciation" } ],
  "too_short": true if the candidate said less than two full sentences, otherwise false,
  "followups": ["1-2 natural follow-up questions an examiner would ask next, based on what this candidate actually said"]
}
Bands are IELTS bands 0-9 in .0 or .5 steps. Max 4 errors, the most important ones.
Follow-up questions must be short, spoken English, directly tied to something the candidate mentioned, and must not repeat the original question.
All text in English.`);

const FINAL_PROMPT = (data) => `You are a certified IELTS Speaking examiner writing the final report of a complete IELTS Speaking test
(Part 1 short questions, Part 2 long turn, Part 3 discussion). Below are your own notes on every answer, with transcripts.

${JSON.stringify(data, null, 1)}

Weigh Part 2 and Part 3 more heavily than Part 1, and consider the candidate's overall consistency.
Return JSON only, no markdown:
{
  "fluency": { "band": number, "comment": "2 sentences" },
  "lexical": { "band": number, "comment": "2 sentences" },
  "grammar": { "band": number, "comment": "2 sentences" },
  "pronunciation": { "band": number, "comment": "2 sentences" },
  "overall_band": number,
  "cefr": "A1 | A2 | B1 | B2 | C1 | C2",
  "strengths": ["3 short bullet points"],
  "improvements": [ { "issue": "short title", "example": "what the candidate said", "better": "how to say it", "advice": "one sentence of practical advice" } ],
  "next_steps": ["3 concrete things to practise before the next test"],
  "summary": "3-4 sentences addressed to the candidate, encouraging but honest"
}
overall_band is the average of the four criteria rounded to the nearest 0.5. Max 4 improvements. All text in English.`;

const band = (v) => {
  const n = Math.round(Number(v) * 2) / 2;
  return Number.isFinite(n) ? Math.max(0, Math.min(9, n)) : null;
};

// ---------- kirish kodlari ----------
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789'; // chalkashadigan (O/0, I/1) va unli harflarsiz — tasodifiy so'z chiqmaydi
const normCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
const prettyCode = (c) => (c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c);
const makeCode = () => Array.from(crypto.randomFillSync(new Uint8Array(8)))
  .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

module.exports = function mountSpeaking(app, ctx) {
  const { q, one, tx, h, clean, intId, optId, shuffle, requireAdmin } = ctx;

  // Sozlamalar bazadan o'qiladi va 60 soniya keshda turadi
  let cfgCache = null, cfgAt = 0;
  async function config(force) {
    if (!force && cfgCache && Date.now() - cfgAt < 60_000) return cfgCache;
    let saved = null;
    try {
      const row = await one('SELECT data FROM speak_config WHERE id=1');
      if (row && row.data) saved = JSON.parse(row.data);
    } catch (e) { console.error('speak_config:', e.message); }
    cfgCache = mergeConfig(saved); cfgAt = Date.now();
    return cfgCache;
  }

  // ---------- O'QUVCHI ----------
  app.get('/api/speaking/status', h(async (req, res) => {
    const cfg = await config();
    const c = await one(`SELECT
      (SELECT COUNT(*) FROM speak_items i JOIN speak_topics t ON t.id=i.topic_id WHERE t.active AND i.part=1) p1,
      (SELECT COUNT(*) FROM speak_items i JOIN speak_topics t ON t.id=i.topic_id WHERE t.active AND i.part=2) p2`);
    const need = cfg.counts.p1_topics * cfg.counts.p1_per_topic;
    res.json({ enabled: !!KEY() && c.p1 >= need && c.p2 >= 1, model: MODEL, parts: cfg.timings });
  }));

  // Kodni oldindan tekshirish (imtihon boshlanmaydi, kod ham sarflanmaydi)
  app.post('/api/speaking/code/check', h(async (req, res) => {
    const code = normCode(req.body.code);
    if (!code) return res.json({ ok: false, error: 'Kirish kodini kiriting' });
    const row = await one('SELECT * FROM speak_codes WHERE code=$1', [code]);
    if (!row) return res.json({ ok: false, error: 'Bunday kod topilmadi' });
    if (!row.active) return res.json({ ok: false, error: 'Bu kod bekor qilingan' });
    if (row.expires_at && Number(row.expires_at) < Date.now()) return res.json({ ok: false, error: 'Bu kodning muddati tugagan' });
    if (row.used >= row.max_uses) return res.json({ ok: false, error: 'Bu kod allaqachon ishlatilgan' });
    res.json({ ok: true, left: row.max_uses - row.used });
  }));

  // Imtihonni boshlash: Part 1 uchun bitta mavzu, Part 2/3 uchun boshqa mavzu tasodifiy tanlanadi
  app.post('/api/speaking/sessions', h(async (req, res) => {
    if (!KEY()) return res.status(503).json({ error: 'AI baholash hozircha sozlanmagan' });
    const cfg = await config();
    const b = req.body;
    const name = clean(b.student_name, 100), phone = clean(b.phone, 30);
    if (name.length < 3) return res.status(400).json({ error: 'Ism-familiyani to\'liq kiriting' });
    if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'Telefon raqamni to\'g\'ri kiriting' });

    // Registon o'quvchisi ustoz/guruhni tanlaydi (bepul), tashqaridan kelgan kirish kodini kiritadi
    const guest = String(b.student_type || '').toLowerCase() === 'guest';
    let teacherId = null, groupId = null, teacherName = '', groupName = '', code = '';

    if (guest) {
      code = normCode(b.code);
      if (!code) return res.status(400).json({ error: 'Kirish kodini kiriting' });
      const row = await one('SELECT * FROM speak_codes WHERE code=$1', [code]);
      if (!row) return res.status(400).json({ error: 'Bunday kod topilmadi' });
      if (!row.active) return res.status(400).json({ error: 'Bu kod bekor qilingan' });
      if (row.expires_at && Number(row.expires_at) < Date.now()) return res.status(400).json({ error: 'Bu kodning muddati tugagan' });
      if (row.used >= row.max_uses) return res.status(400).json({ error: 'Bu kod allaqachon ishlatilgan' });
    } else {
      const counts = await one(`SELECT (SELECT COUNT(*) FROM teachers WHERE active) t, (SELECT COUNT(*) FROM study_groups WHERE active) g`);
      if (counts.t > 0) {
        const t = await one('SELECT id, name FROM teachers WHERE id=$1 AND active', [intId(b.teacher_id)]);
        if (!t) return res.status(400).json({ error: 'Ustozingizni ro\'yxatdan tanlang' });
        teacherId = t.id; teacherName = t.name;
      }
      if (counts.g > 0) {
        const g = await one('SELECT id, name, teacher_id FROM study_groups WHERE id=$1 AND active', [intId(b.group_id)]);
        if (!g) return res.status(400).json({ error: 'Guruhingizni ro\'yxatdan tanlang' });
        if (teacherId && g.teacher_id && g.teacher_id !== teacherId) return res.status(400).json({ error: 'Bu guruh tanlangan ustozga tegishli emas' });
        groupId = g.id; groupName = g.name;
      }
    }

    const items = await q(`SELECT i.*, t.title topic FROM speak_items i JOIN speak_topics t ON t.id=i.topic_id
                           WHERE t.active ORDER BY i.position, i.id`);
    const byTopic = (part) => items.filter((x) => x.part === part);
    const p1Topics = [...new Set(byTopic(1).map((x) => x.topic_id))];
    const p2Items = byTopic(2);
    if (!p1Topics.length || !p2Items.length) return res.status(400).json({ error: 'Savollar bazasi hali to\'ldirilmagan' });

    // Part 2 kartochkasi, keyin Part 3 o'sha mavzuda; Part 1 esa boshqa mavzulardan
    const cnt = cfg.counts;
    const cue = shuffle(p2Items)[0];
    const p1Pool = p1Topics.filter((id) => id !== cue.topic_id);
    const p1Chosen = shuffle(p1Pool.length >= cnt.p1_topics ? p1Pool : p1Topics).slice(0, cnt.p1_topics);
    const p1 = [];
    for (const tid of p1Chosen) {
      const qs = shuffle(byTopic(1).filter((x) => x.topic_id === tid));
      p1.push(...qs.slice(0, cnt.p1_per_topic));
    }

    // Part 3: kartochka mavzusidan; yetmasa boshqa mavzulardan to'ldiriladi
    let p3 = shuffle(byTopic(3).filter((x) => x.topic_id === cue.topic_id)).slice(0, Math.max(cnt.p3_min, cnt.p3_max));
    if (p3.length < cnt.p3_min) {
      const extra = shuffle(byTopic(3).filter((x) => x.topic_id !== cue.topic_id));
      p3 = p3.concat(extra.slice(0, cnt.p3_min - p3.length));
    }
    if (!p1.length || !p3.length) return res.status(400).json({ error: 'Savollar yetarli emas' });

    const fromItem = (x) => ({
      item_id: x.id, part: x.part, topic: x.topic, text: x.text, graded: true,
      bullets: x.part === 2 ? String(x.bullets || '').split('\n').map((s) => s.trim()).filter(Boolean) : [],
      ...cfg.timings[x.part],
    });
    const intro = cfg.texts.intro.map((text) => ({ item_id: null, part: 0, topic: '', text, bullets: [], graded: false, ...cfg.timings[0] }));
    const plan = [...intro, ...p1.map(fromItem), fromItem(cue), ...p3.map(fromItem)];
    plan.forEach((s, i) => { s.idx = i; });

    const id = crypto.randomUUID(), now = Date.now();
    // Kodni band qilish va sessiyani yaratish bitta tranzaksiyada — ikki kishi bir kodni bir vaqtda ishlata olmaydi
    const ok = await tx(async (c) => {
      if (guest) {
        const r = await c.query(
          `UPDATE speak_codes SET used = used + 1
             WHERE code=$1 AND active AND used < max_uses AND (expires_at IS NULL OR expires_at > $2)
             RETURNING id`, [code, now]);
        if (!r.rowCount) return false;
      }
      await c.query(
        `INSERT INTO speak_sessions (id, student_name, phone, teacher, group_name, teacher_id, group_id, plan, started_at, model, student_type, code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, name, phone, teacherName, groupName, teacherId, groupId, JSON.stringify(plan), now, MODEL, guest ? 'guest' : 'registon', code]);
      return true;
    });
    if (!ok) return res.status(400).json({ error: 'Bu kod allaqachon ishlatilgan' });
    res.json({
      session_id: id, plan, server_now: now,
      rules: {
        budget: cfg.budget, roundoff_max: cfg.roundoff_max,
        short_answer_sec: cfg.short_answer_sec, texts: cfg.texts, closing: cfg.texts.closing,
      },
    });
  }));

  // Bitta javobni yuborish: Blob'ga saqlanadi va darhol baholanadi
  app.post('/api/speaking/sessions/:id/answers', h(async (req, res) => {
    const s = await one('SELECT * FROM speak_sessions WHERE id=$1', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Sessiya topilmadi' });
    if (s.finished_at) return res.status(409).json({ error: 'Imtihon yakunlangan' });

    const plan = JSON.parse(s.plan);
    const idx = intId(req.body.idx);
    // Rejadagi savol yoki imtihon davomida AI qo'shgan savol (rounding-off / "tell me more")
    const step = plan.find((p) => p.idx === idx) || (req.body.question ? {
      idx, part: Math.max(0, Math.min(3, parseInt(req.body.part) || 3)),
      text: clean(req.body.question, 400), graded: req.body.graded !== false, extra: true,
    } : null);
    if (!step || !step.text) return res.status(400).json({ error: 'Savol topilmadi' });

    const mime = String(req.body.mime || 'audio/webm').split(';')[0];
    if (!AUDIO_MIMES.includes(mime)) return res.status(400).json({ error: 'Audio formati qo\'llab-quvvatlanmaydi' });
    const b64 = String(req.body.audio || '');
    if (b64.length < 500) return res.status(400).json({ error: 'Audio yozilmadi — mikrofonni tekshiring' });
    if (b64.length > 8_000_000) return res.status(413).json({ error: 'Audio juda katta' });
    const duration = Math.max(0, Math.min(600, parseInt(req.body.duration_sec) || 0));

    // 1) audio saqlanadi (ustoz keyin eshitishi uchun)
    let url = '';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = require('@vercel/blob');
        const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
        const blob = await put(`speaking/${s.id}/${idx}.${ext}`, Buffer.from(b64, 'base64'), {
          access: 'public', contentType: mime, addRandomSuffix: true,
        });
        url = blob.url;
      } catch (e) { console.error('blob:', e.message); }
    }

    // 2) darhol baholanadi (tanishuv bosqichi baholanmaydi — faqat transkripsiya olinadi)
    const grade = step.graded !== false;
    let a;
    try {
      a = await gemini([{ text: ANSWER_PROMPT(step.part, step.text, grade) }, { inlineData: { mimeType: mime, data: b64 } }]);
    } catch (e) {
      console.error('gemini answer:', e.message);
      a = { transcript: '', word_count: 0, bands: {}, notes: { error: e.message }, errors: [], failed: true };
    }
    if (!grade) { a.bands = {}; a.errors = []; a.skip_scoring = true; }

    await q(`INSERT INTO speak_answers (session_id, idx, part, question, audio_url, duration_sec, transcript, analysis, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (session_id, idx) DO UPDATE SET audio_url=EXCLUDED.audio_url, duration_sec=EXCLUDED.duration_sec,
               transcript=EXCLUDED.transcript, analysis=EXCLUDED.analysis, created_at=EXCLUDED.created_at`,
      [s.id, idx, step.part, step.text, url, duration, clean(a.transcript, 6000), JSON.stringify(a), Date.now()]);

    res.json({
      ok: true, idx, transcript: a.transcript || '', graded: !a.failed,
      // imtihon oluvchining javobga bog'liq keyingi savollari (Part 2 rounding-off va h.k.)
      followups: Array.isArray(a.followups) ? a.followups.filter(Boolean).slice(0, (await config()).roundoff_max).map((t) => clean(t, 300)) : [],
      too_short: !!a.too_short,
      next: idx + 1 < plan.length ? idx + 1 : null,
    });
  }));

  // Yakunlash: barcha javoblar bo'yicha umumiy hisobot
  app.post('/api/speaking/sessions/:id/finish', h(async (req, res) => {
    const s = await one('SELECT * FROM speak_sessions WHERE id=$1', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Sessiya topilmadi' });
    if (s.finished_at && s.result) return res.json({ ...JSON.parse(s.result), already: true });

    const answers = await q('SELECT * FROM speak_answers WHERE session_id=$1 ORDER BY idx', [s.id]);
    // Tanishuv (part 0) bahoga kirmaydi — faqat Part 1/2/3 javoblari hisoblanadi
    const graded = answers.filter((x) => x.part > 0 && x.transcript && x.transcript.trim().length > 1);
    if (!graded.length) return res.status(400).json({ error: 'Baholash uchun javob topilmadi' });

    const data = graded.map((x) => {
      const an = JSON.parse(x.analysis || '{}');
      return { part: x.part, question: x.question, transcript: x.transcript, seconds: x.duration_sec, bands: an.bands, notes: an.notes, errors: an.errors };
    });

    let result;
    try {
      result = await gemini([{ text: FINAL_PROMPT(data) }], { temperature: 0.1 });
    } catch (e) {
      console.error('gemini final:', e.message);
      return res.status(502).json({ error: 'Baholashda xatolik: ' + e.message });
    }
    for (const k of ['fluency', 'lexical', 'grammar', 'pronunciation']) {
      if (result[k]) result[k].band = band(result[k].band);
    }
    result.overall_band = band(result.overall_band) ??
      band(['fluency', 'lexical', 'grammar', 'pronunciation'].reduce((a, k) => a + (result[k]?.band || 0), 0) / 4);
    result.student_name = s.student_name;
    result.answered = graded.length;
    result.total = JSON.parse(s.plan).length;

    await q(`UPDATE speak_sessions SET finished_at=$1, result=$2, overall_band=$3, cefr=$4 WHERE id=$5`,
      [Date.now(), JSON.stringify(result), result.overall_band, clean(result.cefr, 5), s.id]);
    res.json(result);
  }));

  app.get('/api/speaking/sessions/:id/result', h(async (req, res) => {
    const s = await one('SELECT result FROM speak_sessions WHERE id=$1', [req.params.id]);
    if (!s?.result) return res.status(404).json({ error: 'Natija topilmadi' });
    res.json(JSON.parse(s.result));
  }));

  // ---------- ADMIN ----------
  const admin = require('express').Router();
  admin.use(requireAdmin);

  admin.get('/config', h(async (req, res) => {
    const c = await one(`SELECT (SELECT COUNT(*) FROM speak_topics) topics,
      (SELECT COUNT(*) FROM speak_items WHERE part=1) p1,
      (SELECT COUNT(*) FROM speak_items WHERE part=2) p2,
      (SELECT COUNT(*) FROM speak_items WHERE part=3) p3,
      (SELECT COUNT(*) FROM speak_sessions WHERE finished_at IS NOT NULL) done,
      (SELECT COALESCE(ROUND(AVG(overall_band)::numeric,1),0) FROM speak_sessions WHERE overall_band IS NOT NULL) avg_band,
      (SELECT COUNT(*) FROM speak_codes WHERE active AND used < max_uses AND (expires_at IS NULL OR expires_at > ${Date.now()})) codes_free,
      (SELECT COUNT(*) FROM speak_codes) codes_total`);
    res.json({ ...c, key: !!KEY(), model: MODEL, fallback: FALLBACK_MODEL, blob: !!process.env.BLOB_READ_WRITE_TOKEN });
  }));

  // Kalit uchun mavjud modellar ro'yxati (zaxira modelni tanlash uchun)
  admin.get('/models', h(async (req, res) => {
    if (!KEY()) return res.status(503).json({ error: 'GEMINI_API_KEY sozlanmagan' });
    const r = await fetch(`${API}?key=${KEY()}&pageSize=200`, { signal: AbortSignal.timeout(20_000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: `Gemini ${r.status}: ${(d.error?.message || '').slice(0, 200)}` });
    res.json((d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ name: String(m.name || '').replace('models/', ''), display: m.displayName || '' })));
  }));

  // Modelni tirik sinab ko'rish (zaxira modelni tanlashdan oldin)
  admin.post('/probe', h(async (req, res) => {
    const model = clean(req.body.model, 80);
    if (!model) return res.status(400).json({ error: 'Model nomi kerak' });
    if (!KEY()) return res.status(503).json({ error: 'GEMINI_API_KEY sozlanmagan' });
    const t0 = Date.now();
    try {
      const text = await geminiOnce(model, {
        contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }],
        generationConfig: { temperature: 0 },
      }, 20_000);
      res.json({ ok: true, model, ms: Date.now() - t0, text: String(text).trim().slice(0, 40) });
    } catch (e) {
      res.json({ ok: false, model, ms: Date.now() - t0, status: e.status || 0, error: e.message });
    }
  }));

  // ---------- imtihon sozlamalari (admin) ----------
  admin.get('/settings', h(async (req, res) => {
    res.json({ current: await config(true), defaults: mergeConfig(null) });
  }));

  admin.put('/settings', h(async (req, res) => {
    const merged = mergeConfig(req.body && req.body.reset ? null : req.body);
    await q(`INSERT INTO speak_config (id, data, updated_at) VALUES (1, $1, $2)
             ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at`,
      [JSON.stringify(merged), Date.now()]);
    cfgCache = merged; cfgAt = Date.now();
    res.json({ ok: true, current: merged });
  }));

  // ---------- kirish kodlari (admin) ----------
  admin.get('/codes', h(async (req, res) => {
    const rows = await q(`SELECT c.*, (
        SELECT COUNT(*) FROM speak_sessions s WHERE s.code = c.code AND s.finished_at IS NOT NULL
      ) finished FROM speak_codes c ORDER BY c.created_at DESC, c.id DESC LIMIT 500`);
    res.json(rows.map((r) => ({ ...r, pretty: prettyCode(r.code) })));
  }));

  admin.post('/codes', h(async (req, res) => {
    const count = Math.max(1, Math.min(100, parseInt(req.body.count) || 1));
    const maxUses = Math.max(1, Math.min(500, parseInt(req.body.max_uses) || 1));
    const note = clean(req.body.note, 120);
    const days = Math.max(0, Math.min(365, parseInt(req.body.expires_days) || 0));
    const expires = days ? Date.now() + days * 86400_000 : null;
    const now = Date.now();
    const made = await tx(async (c) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = makeCode();
          const r = await c.query(
            `INSERT INTO speak_codes (code, note, max_uses, expires_at, created_at)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (code) DO NOTHING RETURNING code`,
            [code, note, maxUses, expires, now]);
          if (r.rowCount) { out.push(code); break; }
        }
      }
      return out;
    });
    res.json({ codes: made.map(prettyCode) });
  }));

  admin.put('/codes/:id', h(async (req, res) => {
    await q('UPDATE speak_codes SET active=$1, note=COALESCE($2, note) WHERE id=$3',
      [req.body.active !== false, req.body.note === undefined ? null : clean(req.body.note, 120), intId(req.params.id)]);
    res.json({ ok: true });
  }));

  admin.delete('/codes/:id', h(async (req, res) => {
    await q('DELETE FROM speak_codes WHERE id=$1', [intId(req.params.id)]);
    res.json({ ok: true });
  }));

  // Savollar banki
  admin.get('/topics', h(async (req, res) => {
    const [topics, items] = await Promise.all([
      q('SELECT * FROM speak_topics ORDER BY active DESC, id'),
      q('SELECT * FROM speak_items ORDER BY part, position, id'),
    ]);
    res.json(topics.map((t) => ({ ...t, items: items.filter((i) => i.topic_id === t.id) })));
  }));
  admin.post('/topics', h(async (req, res) => {
    const title = clean(req.body.title, 120);
    if (!title) return res.status(400).json({ error: 'Mavzu nomini kiriting' });
    const r = await one('INSERT INTO speak_topics (title) VALUES ($1) RETURNING id', [title]);
    res.json({ id: r.id });
  }));
  admin.put('/topics/:id', h(async (req, res) => {
    const title = clean(req.body.title, 120);
    if (!title) return res.status(400).json({ error: 'Mavzu nomini kiriting' });
    await q('UPDATE speak_topics SET title=$1, active=$2 WHERE id=$3', [title, req.body.active !== false, intId(req.params.id)]);
    res.json({ ok: true });
  }));
  admin.delete('/topics/:id', h(async (req, res) => {
    await q('DELETE FROM speak_topics WHERE id=$1', [intId(req.params.id)]);
    res.json({ ok: true });
  }));

  const itemFields = (b) => {
    const part = [1, 2, 3].includes(+b.part) ? +b.part : 1;
    const text = clean(b.text, 1000);
    if (!text) return { error: 'Savol matnini kiriting' };
    return { v: [part, text, part === 2 ? clean(b.bullets, 1000) : ''] };
  };
  admin.post('/topics/:id/items', h(async (req, res) => {
    const v = itemFields(req.body);
    if (v.error) return res.status(400).json(v);
    const topicId = intId(req.params.id);
    const r = await one(`INSERT INTO speak_items (part, text, bullets, topic_id, position)
      VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(position),0)+1 FROM speak_items WHERE topic_id=$4)) RETURNING id`, [...v.v, topicId]);
    res.json({ id: r.id });
  }));
  admin.put('/items/:id', h(async (req, res) => {
    const v = itemFields(req.body);
    if (v.error) return res.status(400).json(v);
    await q('UPDATE speak_items SET part=$1, text=$2, bullets=$3 WHERE id=$4', [...v.v, intId(req.params.id)]);
    res.json({ ok: true });
  }));
  admin.delete('/items/:id', h(async (req, res) => {
    await q('DELETE FROM speak_items WHERE id=$1', [intId(req.params.id)]);
    res.json({ ok: true });
  }));

  // Namuna savollar bankini yuklash
  admin.post('/seed', h(async (req, res) => {
    const c = await one('SELECT COUNT(*) n FROM speak_topics');
    if (c.n > 0 && !req.body.force) return res.status(400).json({ error: 'Savollar banki bo\'sh emas' });
    const TOPICS = require('./speaking-seed');
    await tx(async (client) => {
      for (const t of TOPICS) {
        const { rows } = await client.query('INSERT INTO speak_topics (title) VALUES ($1) RETURNING id', [t.title]);
        let pos = 0;
        for (const it of t.items) {
          await client.query('INSERT INTO speak_items (topic_id, part, text, bullets, position) VALUES ($1,$2,$3,$4,$5)',
            [rows[0].id, it.part, it.text, it.bullets || '', ++pos]);
        }
      }
    });
    res.json({ topics: TOPICS.length });
  }));

  // Natijalar
  admin.get('/sessions', h(async (req, res) => {
    const where = ['1=1'], params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.teacher_id) add('s.teacher_id = ?', intId(req.query.teacher_id));
    if (req.query.group_id) add('s.group_id = ?', intId(req.query.group_id));
    if (req.query.search) { params.push(`%${req.query.search}%`); where.push(`(s.student_name ILIKE $${params.length} OR s.phone ILIKE $${params.length})`); }
    if (req.query.status === 'done') where.push('s.finished_at IS NOT NULL');
    if (req.query.status === 'open') where.push('s.finished_at IS NULL');
    if (req.query.type === 'guest') where.push("s.student_type = 'guest'");
    if (req.query.type === 'registon') where.push("s.student_type <> 'guest'");
    res.json(await q(`SELECT s.id, s.student_name, s.phone, s.teacher, s.group_name, s.started_at, s.finished_at,
        s.overall_band, s.cefr, s.teacher_band, s.student_type, s.code,
        (SELECT COUNT(*) FROM speak_answers a WHERE a.session_id=s.id) answers
      FROM speak_sessions s WHERE ${where.join(' AND ')} ORDER BY s.started_at DESC LIMIT 500`, params));
  }));
  admin.get('/sessions/:id', h(async (req, res) => {
    const s = await one('SELECT * FROM speak_sessions WHERE id=$1', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Topilmadi' });
    const answers = await q('SELECT * FROM speak_answers WHERE session_id=$1 ORDER BY idx', [s.id]);
    res.json({
      ...s, plan: JSON.parse(s.plan), result: s.result ? JSON.parse(s.result) : null,
      answers: answers.map((a) => ({ ...a, analysis: a.analysis ? JSON.parse(a.analysis) : null })),
    });
  }));
  admin.put('/sessions/:id/teacher', h(async (req, res) => {
    const b = band(req.body.teacher_band);
    await q('UPDATE speak_sessions SET teacher_band=$1, teacher_note=$2 WHERE id=$3',
      [b, clean(req.body.teacher_note, 2000), req.params.id]);
    res.json({ ok: true });
  }));
  admin.delete('/sessions/:id', h(async (req, res) => {
    await q('DELETE FROM speak_sessions WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  app.use('/api/admin/speaking', admin);
};

module.exports.SCHEMA = SCHEMA;
