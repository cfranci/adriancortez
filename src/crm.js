// Super-simple CRM on D1. All routes admin-gated by the caller (worker.js).
// Tables: contacts (shared with marketing) + activities. See migrations/0002_crm.sql.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const STAGES = ["lead", "buyer", "seller", "under_contract", "closed", "past_client"];
const KINDS = ["note", "call", "text", "email", "showing", "meeting"];

const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);

// loose US-default E.164 normalization; returns "" if hopeless
export function normPhone(raw) {
  const d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return d.slice(0, 16);
  const digits = d.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits.slice(0, 15);
}

async function contactRow(env, id) {
  return env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(id).first();
}

export async function handleCrm(req, env, url) {
  if (!env.DB) return json({ error: "database not provisioned yet" }, 503);
  const path = url.pathname.replace(/^\/api\/admin\/crm/, "");
  const m = (re) => path.match(re);
  let match;

  // GET /today — due or overdue follow-ups, oldest first
  if (path === "/today" && req.method === "GET") {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await env.DB.prepare(
      `SELECT c.*, (SELECT MAX(ts) FROM activities a WHERE a.contact_id = c.id) AS last_touch
       FROM contacts c
       WHERE c.next_followup IS NOT NULL AND c.next_followup != '' AND c.next_followup <= ?
       ORDER BY c.next_followup ASC LIMIT 100`
    ).bind(today).all();
    return json(rows.results);
  }

  // GET /contacts?q=&stage=
  if (path === "/contacts" && req.method === "GET") {
    const q = clean(url.searchParams.get("q"), 80);
    const stage = clean(url.searchParams.get("stage"), 30);
    let sql =
      `SELECT c.*, (SELECT MAX(ts) FROM activities a WHERE a.contact_id = c.id) AS last_touch
       FROM contacts c WHERE 1=1`;
    const binds = [];
    if (q) { sql += " AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)"; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (stage && STAGES.includes(stage)) { sql += " AND c.stage = ?"; binds.push(stage); }
    sql += " ORDER BY c.created DESC LIMIT 300";
    const rows = await env.DB.prepare(sql).bind(...binds).all();
    return json(rows.results);
  }

  // POST /contacts — create
  if (path === "/contacts" && req.method === "POST") {
    let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const name = clean(b.name, 120);
    if (!name) return json({ error: "name required" }, 422);
    const phone = normPhone(b.phone);
    const stage = STAGES.includes(b.stage) ? b.stage : "lead";
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO contacts (id, name, phone, email, tags, stage, notes, next_followup, consent_sms, consent_email, source, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, name, phone, clean(b.email, 160), clean(b.tags, 300), stage,
      clean(b.notes, 2000), clean(b.next_followup, 10),
      b.consent_sms ? 1 : 0, b.consent_email ? 1 : 0,
      clean(b.source, 60) || "manual", new Date().toISOString()
    ).run();
    return json(await contactRow(env, id), 201);
  }

  // GET /contacts/:id — detail + activities
  if ((match = m(/^\/contacts\/([0-9a-f-]{36})$/)) && req.method === "GET") {
    const c = await contactRow(env, match[1]);
    if (!c) return json({ error: "not found" }, 404);
    const acts = await env.DB.prepare(
      "SELECT * FROM activities WHERE contact_id = ? ORDER BY ts DESC LIMIT 100"
    ).bind(match[1]).all();
    return json({ ...c, activities: acts.results });
  }

  // PATCH /contacts/:id — update fields
  if ((match = m(/^\/contacts\/([0-9a-f-]{36})$/)) && req.method === "PATCH") {
    const c = await contactRow(env, match[1]);
    if (!c) return json({ error: "not found" }, 404);
    let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const fields = {
      name: b.name !== undefined ? clean(b.name, 120) || c.name : c.name,
      phone: b.phone !== undefined ? normPhone(b.phone) : c.phone,
      email: b.email !== undefined ? clean(b.email, 160) : c.email,
      tags: b.tags !== undefined ? clean(b.tags, 300) : c.tags,
      stage: STAGES.includes(b.stage) ? b.stage : c.stage,
      notes: b.notes !== undefined ? clean(b.notes, 2000) : c.notes,
      next_followup: b.next_followup !== undefined ? clean(b.next_followup, 10) : c.next_followup,
      consent_sms: b.consent_sms !== undefined ? (b.consent_sms ? 1 : 0) : c.consent_sms,
      consent_email: b.consent_email !== undefined ? (b.consent_email ? 1 : 0) : c.consent_email,
    };
    await env.DB.prepare(
      `UPDATE contacts SET name=?, phone=?, email=?, tags=?, stage=?, notes=?, next_followup=?, consent_sms=?, consent_email=? WHERE id=?`
    ).bind(fields.name, fields.phone, fields.email, fields.tags, fields.stage, fields.notes,
           fields.next_followup, fields.consent_sms, fields.consent_email, match[1]).run();
    return json(await contactRow(env, match[1]));
  }

  // DELETE /contacts/:id
  if ((match = m(/^\/contacts\/([0-9a-f-]{36})$/)) && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM activities WHERE contact_id = ?").bind(match[1]).run();
    await env.DB.prepare("DELETE FROM contacts WHERE id = ?").bind(match[1]).run();
    return json({ ok: true });
  }

  // POST /contacts/:id/activity — log a touch; optional next_followup reschedule
  if ((match = m(/^\/contacts\/([0-9a-f-]{36})\/activity$/)) && req.method === "POST") {
    const c = await contactRow(env, match[1]);
    if (!c) return json({ error: "not found" }, 404);
    let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const kind = KINDS.includes(b.kind) ? b.kind : "note";
    await env.DB.prepare(
      "INSERT INTO activities (id, contact_id, kind, body, ts) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), match[1], kind, clean(b.body, 2000), new Date().toISOString()).run();
    if (b.next_followup !== undefined) {
      await env.DB.prepare("UPDATE contacts SET next_followup = ? WHERE id = ?")
        .bind(clean(b.next_followup, 10), match[1]).run();
    }
    return json({ ok: true }, 201);
  }

  // POST /import-leads — pull KV lead inbox into contacts (skip existing phones)
  if (path === "/import-leads" && req.method === "POST") {
    const list = await env.SITE.list({ prefix: "lead:", limit: 200 });
    let imported = 0, skipped = 0;
    for (const k of list.keys) {
      const v = await env.SITE.get(k.name);
      if (!v) continue;
      const lead = JSON.parse(v);
      const phone = normPhone(lead.phone);
      const dupe = phone
        ? await env.DB.prepare("SELECT id FROM contacts WHERE phone = ?").bind(phone).first()
        : null;
      if (dupe) { skipped++; continue; }
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO contacts (id, name, phone, email, tags, stage, notes, next_followup, consent_sms, consent_email, source, created)
         VALUES (?, ?, ?, ?, '', 'lead', ?, '', 0, 0, 'site-lead', ?)`
      ).bind(id, clean(lead.name, 120) || "Site lead", phone, clean(lead.email, 160),
             clean(lead.message, 2000), new Date(lead.ts || Date.now()).toISOString()).run();
      await env.DB.prepare(
        "INSERT INTO activities (id, contact_id, kind, body, ts) VALUES (?, ?, 'note', ?, ?)"
      ).bind(crypto.randomUUID(), id, "Came in through the site contact form" + (lead.message ? ": " + clean(lead.message, 500) : ""),
             new Date(lead.ts || Date.now()).toISOString()).run();
      imported++;
    }
    return json({ ok: true, imported, skipped });
  }

  return json({ error: "not found" }, 404);
}
