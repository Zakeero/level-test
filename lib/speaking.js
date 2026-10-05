// AI Speaking — IELTS uslubidagi og'zaki imtihon (Gemini bilan baholanadi)
const crypto = require('crypto');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
// Bepul tarifda model vaqtincha band bo'lishi mumkin (503) — shunda zaxira model sinab ko'riladi
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || '';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY = () => process.env.GEMINI_API_KEY || '';
const RETRY_STATUS = [408, 429, 500, 502, 503, 504];
const RETRY_DELAYS = [700, 1800, 3500]; // urinishlar orasidagi kutish (ms)
const TIMINGS = { 1: { prep: 0, answer: 30 }, 2: { prep: 60, answer: 120 }, 3: { prep: 0, answer: 45 } };
const PART1_COUNT = 4, PART3_COUNT = 3;
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

const ANSWER_PROMPT = (part, question) => `You are a certified IELTS Speaking examiner.
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
  "errors": [ { "said": "what the candidate said", "better": "corrected version", "type": "grammar | vocabulary | pronunciation" } ]
}
Bands are IELTS bands 0-9 in .0 or .5 steps. Max 4 errors, the most important ones. All text in English.`;

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

  // ---------- O'QUVCHI ----------
  app.get('/api/speaking/status', h(async (req, res) => {
    const c = await one(`SELECT
      (SELECT COUNT(*) FROM speak_items i JOIN speak_topics t ON t.id=i.topic_id WHERE t.active AND i.part=1) p1,
      (SELECT COUNT(*) FROM speak_items i JOIN speak_topics t ON t.id=i.topic_id WHERE t.active AND i.part=2) p2`);
    res.json({ enabled: !!KEY() && c.p1 >= PART1_COUNT && c.p2 >= 1, model: MODEL, parts: TIMINGS });
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

    const cue = shuffle(p2Items)[0];
    const p1Pool = p1Topics.filter((id) => id !== cue.topic_id);
    const p1Topic = shuffle(p1Pool.length ? p1Pool : p1Topics)[0];
    const p1 = shuffle(byTopic(1).filter((x) => x.topic_id === p1Topic)).slice(0, PART1_COUNT);
    const p3 = shuffle(byTopic(3).filter((x) => x.topic_id === cue.topic_id)).slice(0, PART3_COUNT);

    const plan = [...p1, cue, ...p3].map((x, i) => ({
      idx: i, item_id: x.id, part: x.part, topic: x.topic,
      text: x.text, bullets: x.part === 2 ? x.bullets.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      prep_sec: TIMINGS[x.part].prep, answer_sec: TIMINGS[x.part].answer,
    }));
    if (plan.length < 2) return res.status(400).json({ error: 'Savollar yetarli emas' });

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
    res.json({ session_id: id, plan, server_now: now });
  }));

  // Bitta javobni yuborish: Blob'ga saqlanadi va darhol baholanadi
  app.post('/api/speaking/sessions/:id/answers', h(async (req, res) => {
    const s = await one('SELECT * FROM speak_sessions WHERE id=$1', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Sessiya topilmadi' });
    if (s.finished_at) return res.status(409).json({ error: 'Imtihon yakunlangan' });

    const plan = JSON.parse(s.plan);
    const idx = intId(req.body.idx);
    const step = plan.find((p) => p.idx === idx);
    if (!step) return res.status(400).json({ error: 'Savol topilmadi' });

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

    // 2) darhol baholanadi
    let a;
    try {
      a = await gemini([{ text: ANSWER_PROMPT(step.part, step.text) }, { inlineData: { mimeType: mime, data: b64 } }]);
    } catch (e) {
      console.error('gemini answer:', e.message);
      a = { transcript: '', word_count: 0, bands: {}, notes: { error: e.message }, errors: [], failed: true };
    }

    await q(`INSERT INTO speak_answers (session_id, idx, part, question, audio_url, duration_sec, transcript, analysis, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (session_id, idx) DO UPDATE SET audio_url=EXCLUDED.audio_url, duration_sec=EXCLUDED.duration_sec,
               transcript=EXCLUDED.transcript, analysis=EXCLUDED.analysis, created_at=EXCLUDED.created_at`,
      [s.id, idx, step.part, step.text, url, duration, clean(a.transcript, 6000), JSON.stringify(a), Date.now()]);

    res.json({ ok: true, idx, transcript: a.transcript || '', graded: !a.failed, next: idx + 1 < plan.length ? idx + 1 : null });
  }));

  // Yakunlash: barcha javoblar bo'yicha umumiy hisobot
  app.post('/api/speaking/sessions/:id/finish', h(async (req, res) => {
    const s = await one('SELECT * FROM speak_sessions WHERE id=$1', [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Sessiya topilmadi' });
    if (s.finished_at && s.result) return res.json({ ...JSON.parse(s.result), already: true });

    const answers = await q('SELECT * FROM speak_answers WHERE session_id=$1 ORDER BY idx', [s.id]);
    const graded = answers.filter((x) => x.transcript && x.transcript.trim().length > 1);
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
