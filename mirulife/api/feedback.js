// ご意見・ご要望の受付（Mirulife Shift）
// - 内容は Vercel Blob（非公開ストア）に1件ずつJSONで保存します。Vercel の管理画面 Storage → Blob で読めます。
// - 環境変数 RESEND_API_KEY と FEEDBACK_TO が設定されていれば、届いたときにメールでも知らせます（任意）。
// - 勤務表のデータは受け取りません（画面から送るのは、書かれた内容・画面名・端末の種類だけ）。
const { put } = require('@vercel/blob');

const KINDS = { idea: 'こんな機能がほしい', bug: 'うまく動かない・おかしい', hard: '使い方がわかりにくい', other: 'その他' };
const hits = new Map(); // 同じ接続元からの連続送信をゆるく抑える（関数インスタンスごと）

function clip(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n); }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= 5) return res.status(429).json({ ok: false, error: 'too_many' });
  list.push(now); hits.set(ip, list);

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return res.status(400).json({ ok: false });

  const text = clip(b.text, 2000).trim();
  if (text.length < 2) return res.status(400).json({ ok: false, error: 'empty' });
  const email = clip(b.email, 200).trim();
  const item = {
    at: new Date(now).toISOString(),
    kind: KINDS[b.kind] ? b.kind : 'other',
    text,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    tab: clip(b.tab, 20),
    mobile: !!b.mobile,
    lang: clip(b.lang, 20),
    ua: clip(req.headers['user-agent'], 300),
  };

  try {
    const d = item.at.slice(0, 10);
    const id = item.at.replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 8);
    await put(`feedback/${d}/${id}.json`, JSON.stringify(item, null, 1), {
      access: 'private', contentType: 'application/json; charset=utf-8', addRandomSuffix: false,
    });
  } catch (e) {
    console.error('feedback save failed', e && e.message);
    return res.status(500).json({ ok: false });
  }

  const key = process.env.RESEND_API_KEY, to = process.env.FEEDBACK_TO;
  if (key && to) {
    try {
      const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.FEEDBACK_FROM || 'Mirulife Shift <onboarding@resend.dev>',
          to: to.split(',').map(s => s.trim()).filter(Boolean),
          reply_to: item.email || undefined,
          subject: `【Mirulife Shift ご意見】${KINDS[item.kind]}`,
          html: `<p><b>${esc(KINDS[item.kind])}</b>（画面：${esc(item.tab)}／${item.mobile ? 'スマホ' : 'パソコン'}）</p><pre style="white-space:pre-wrap;font:inherit">${esc(item.text)}</pre><p>返信先：${esc(item.email || 'なし')}</p><p style="color:#888">${esc(item.at)}</p>`,
        }),
      });
    } catch (e) { console.error('feedback mail failed', e && e.message); }
  }
  return res.status(200).json({ ok: true });
};
