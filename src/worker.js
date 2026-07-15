// adriancortez worker: static site + KV content + lead inbox + admin auth.
// Auth: POST /api/admin/login with the admin key sets a signed HttpOnly cookie.
// All /api/admin/* routes require that cookie or "Authorization: Bearer <key>".

import { handleCrm } from "./crm.js";

const COOKIE = "ac_admin";
const SESSION_HOURS = 24 * 7;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeToken(env) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  return `${exp}.${await hmac(env.ADMIN_KEY, String(exp))}`;
}

async function validToken(env, token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expect = await hmac(env.ADMIN_KEY, exp);
  return sig === expect;
}

function getCookie(req, name) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

async function isAdmin(req, env) {
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer && bearer === env.ADMIN_KEY) return true;
  return validToken(env, getCookie(req, COOKIE));
}

const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // ---------- public API ----------
    if (path === "/api/content" && req.method === "GET") {
      const content = await env.SITE.get("content");
      if (!content) return json({ error: "no content" }, 404);
      return new Response(content, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      });
    }

    if (path === "/api/lead" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
      if (clean(body.company)) return json({ ok: true }); // honeypot: silently drop bots
      const name = clean(body.name, 120);
      const phone = clean(body.phone, 40);
      const message = clean(body.message, 1200);
      if (!name || (!phone && !clean(body.email))) return json({ error: "name and phone required" }, 422);
      const id = `${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`;
      await env.SITE.put(
        `lead:${id}`,
        JSON.stringify({ id, name, phone, email: clean(body.email, 160), message, ts: Date.now(), handled: false }),
        { expirationTtl: 60 * 60 * 24 * 365 }
      );
      return json({ ok: true });
    }

    // ---------- admin auth ----------
    if (path === "/api/admin/login" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
      if (clean(body.key, 200) !== env.ADMIN_KEY) {
        // small delay to blunt guessing
        await new Promise((r) => setTimeout(r, 800));
        return json({ error: "wrong key" }, 401);
      }
      const token = await makeToken(env);
      return json({ ok: true }, 200, {
        "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`,
      });
    }

    if (path === "/api/admin/logout" && req.method === "POST") {
      return json({ ok: true }, 200, {
        "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      });
    }

    // ---------- admin API (gated) ----------
    if (path.startsWith("/api/admin/")) {
      if (!(await isAdmin(req, env))) return json({ error: "unauthorized" }, 401);

      if (path === "/api/admin/session" && req.method === "GET") return json({ ok: true });

      if (path.startsWith("/api/admin/crm/")) return handleCrm(req, env, url);

      if (path === "/api/admin/content") {
        if (req.method === "GET") {
          const content = await env.SITE.get("content");
          return content ? new Response(content, { headers: { "Content-Type": "application/json" } }) : json({});
        }
        if (req.method === "PUT") {
          let body;
          try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
          body.updated = new Date().toISOString();
          await env.SITE.put("content", JSON.stringify(body));
          return json({ ok: true, updated: body.updated });
        }
      }

      if (path === "/api/admin/leads" && req.method === "GET") {
        const list = await env.SITE.list({ prefix: "lead:", limit: 200 });
        const leads = [];
        for (const k of list.keys) {
          const v = await env.SITE.get(k.name);
          if (v) leads.push(JSON.parse(v));
        }
        leads.sort((a, b) => b.ts - a.ts);
        return json(leads);
      }

      const leadAction = path.match(/^\/api\/admin\/leads\/([^/]+)\/(handled|delete)$/);
      if (leadAction && req.method === "POST") {
        const key = `lead:${decodeURIComponent(leadAction[1])}`;
        const v = await env.SITE.get(key);
        if (!v) return json({ error: "not found" }, 404);
        if (leadAction[2] === "delete") {
          await env.SITE.delete(key);
        } else {
          const lead = JSON.parse(v);
          lead.handled = !lead.handled;
          await env.SITE.put(key, JSON.stringify(lead));
        }
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    }

    // everything else: static assets (site + /admin page)
    return env.ASSETS.fetch(req);
  },
};
