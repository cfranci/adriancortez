// CRM tab — renders into #tab-crm. Uses the page's $, esc, api helpers.
(() => {
  const STAGES = { lead: "Lead", buyer: "Buyer", seller: "Seller", under_contract: "Under contract", closed: "Closed", past_client: "Past client" };
  const KINDS = ["call", "text", "email", "showing", "meeting", "note"];
  let filterStage = "", query = "", openId = null;

  const root = document.getElementById("tab-crm");
  root.innerHTML = `
    <div class="panel" id="crmToday"></div>
    <div class="panel">
      <h2>Contacts</h2>
      <div class="crm-tools">
        <input id="crmSearch" placeholder="Search name, phone, email…" style="max-width:280px">
        <div class="crm-pills" id="crmPills"></div>
        <span style="flex:1"></span>
        <button class="btn sm ghost" id="crmImport" type="button">Import from lead inbox</button>
        <button class="btn sm solid" id="crmAdd" type="button">+ Contact</button>
      </div>
      <div id="crmList">Loading…</div>
    </div>
    <div class="crm-drawer hide" id="crmDrawer"></div>`;

  const pills = ["", ...Object.keys(STAGES)];
  const renderPills = () => {
    document.getElementById("crmPills").innerHTML = pills.map((s) =>
      `<button class="pill ${filterStage === s ? "on" : ""}" data-stage="${s}">${s ? esc(STAGES[s]) : "All"}</button>`).join("");
  };

  const fmtDay = (d) => (d ? new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
  const ago = (ts) => {
    if (!ts) return "no touches yet";
    const days = Math.floor((Date.now() - new Date(ts)) / 864e5);
    return days === 0 ? "today" : days === 1 ? "yesterday" : days + "d ago";
  };
  const overdue = (d) => d && d <= new Date().toISOString().slice(0, 10);

  async function loadToday() {
    const rows = await (await api("/api/admin/crm/today")).json();
    document.getElementById("crmToday").innerHTML = `
      <h2>Follow up today${rows.length ? ` <span class="count">${rows.length}</span>` : ""}</h2>
      ${rows.length ? rows.map((c) => `
        <div class="crm-row due" data-open="${esc(c.id)}">
          <b>${esc(c.name)}</b>
          <span class="chip">${esc(STAGES[c.stage] || c.stage)}</span>
          <span class="dim">due ${esc(fmtDay(c.next_followup))} · last touch ${esc(ago(c.last_touch))}</span>
          ${c.phone ? `<a class="btn sm ghost" href="sms:${esc(c.phone)}" onclick="event.stopPropagation()">Text</a>
          <a class="btn sm ghost" href="tel:${esc(c.phone)}" onclick="event.stopPropagation()">Call</a>` : ""}
        </div>`).join("")
      : '<p class="dim">Nothing due. Set a follow-up date on any contact and it shows up here on the day.</p>'}`;
  }

  async function loadList() {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (filterStage) p.set("stage", filterStage);
    const rows = await (await api("/api/admin/crm/contacts?" + p)).json();
    document.getElementById("crmList").innerHTML = rows.length ? rows.map((c) => `
      <div class="crm-row" data-open="${esc(c.id)}">
        <b>${esc(c.name)}</b>
        <span class="chip">${esc(STAGES[c.stage] || c.stage)}</span>
        <span class="dim">${esc(c.phone || c.email || "no contact info")}</span>
        <span class="dim right">${c.next_followup ? (overdue(c.next_followup) ? "⚠ " : "→ ") + esc(fmtDay(c.next_followup)) : esc(ago(c.last_touch))}</span>
      </div>`).join("")
    : '<p class="dim">No contacts yet. Add one, or import the lead inbox.</p>';
  }

  function drawerForm(c = {}) {
    return `
      <div class="drawer-head">
        <h2>${c.id ? esc(c.name) : "New contact"}</h2>
        <button class="btn sm ghost" id="crmClose" type="button">Close</button>
      </div>
      <div class="lrow" style="grid-template-columns:1fr 1fr">
        <div><label>Name</label><input data-cf="name" value="${esc(c.name)}"></div>
        <div><label>Stage</label><select data-cf="stage">${Object.entries(STAGES).map(([k, v]) =>
          `<option value="${k}" ${c.stage === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div><label>Phone</label><input data-cf="phone" value="${esc(c.phone)}"></div>
        <div><label>Email</label><input data-cf="email" value="${esc(c.email)}"></div>
        <div><label>Tags (comma separated)</label><input data-cf="tags" value="${esc(c.tags)}"></div>
        <div><label>Next follow-up</label><input type="date" data-cf="next_followup" value="${esc(c.next_followup)}"></div>
        <div class="full"><label>Notes</label><textarea data-cf="notes" rows="3">${esc(c.notes)}</textarea></div>
        <div class="full" style="display:flex;gap:.5rem;align-items:center">
          <button class="btn solid sm" id="crmSave" type="button">${c.id ? "Save" : "Create"}</button>
          ${c.id ? '<button class="btn sm danger" id="crmDelete" type="button">Delete</button>' : ""}
          <span class="dim" id="crmSaveNote"></span>
        </div>
      </div>
      ${c.id ? `
      <h2 style="margin-top:1.4rem">Log a touch</h2>
      <div class="crm-log">
        ${KINDS.map((k) => `<button class="pill" data-kind="${k}">${k}</button>`).join("")}
        <input id="crmLogBody" placeholder="What happened? (optional)">
        <input type="date" id="crmLogNext" title="Next follow-up">
        <button class="btn sm solid" id="crmLog" type="button">Log</button>
      </div>
      <div class="timeline">
        ${(c.activities || []).map((a) => `
          <div class="tl-item"><span class="tl-kind">${esc(a.kind)}</span>
          <span class="dim">${esc(new Date(a.ts).toLocaleString())}</span>
          ${a.body ? `<div>${esc(a.body)}</div>` : ""}</div>`).join("") || '<p class="dim">No activity yet.</p>'}
      </div>` : ""}`;
  }

  let logKind = "note";
  async function openDrawer(id) {
    openId = id;
    const drawer = document.getElementById("crmDrawer");
    drawer.classList.remove("hide");
    drawer.innerHTML = id
      ? drawerForm(await (await api("/api/admin/crm/contacts/" + id)).json())
      : drawerForm();
    logKind = "note";
  }

  function collectDrawer() {
    const o = {};
    document.querySelectorAll("#crmDrawer [data-cf]").forEach((el) => (o[el.dataset.cf] = el.value));
    return o;
  }

  root.addEventListener("click", async (e) => {
    const rowEl = e.target.closest("[data-open]");
    if (rowEl && !e.target.closest("a,button")) return openDrawer(rowEl.dataset.open);
    const pill = e.target.closest(".pill[data-stage]");
    if (pill) { filterStage = pill.dataset.stage; renderPills(); return loadList(); }
    if (e.target.id === "crmAdd") return openDrawer(null);
    if (e.target.id === "crmClose") return document.getElementById("crmDrawer").classList.add("hide");
    if (e.target.id === "crmImport") {
      e.target.disabled = true; e.target.textContent = "Importing…";
      const r = await (await api("/api/admin/crm/import-leads", { method: "POST" })).json();
      e.target.disabled = false; e.target.textContent = "Import from lead inbox";
      alert(`Imported ${r.imported}, skipped ${r.skipped} already in the CRM.`);
      return loadList();
    }
    if (e.target.id === "crmSave") {
      const body = JSON.stringify(collectDrawer());
      const r = openId
        ? await api("/api/admin/crm/contacts/" + openId, { method: "PATCH", body })
        : await api("/api/admin/crm/contacts", { method: "POST", body });
      if (r.ok) { const c = await r.json(); openDrawer(c.id); loadList(); loadToday(); }
      else document.getElementById("crmSaveNote").textContent = "Save failed";
      return;
    }
    if (e.target.id === "crmDelete") {
      if (!confirm("Delete this contact and their history?")) return;
      await api("/api/admin/crm/contacts/" + openId, { method: "DELETE" });
      document.getElementById("crmDrawer").classList.add("hide");
      loadList(); loadToday(); return;
    }
    const kindBtn = e.target.closest(".pill[data-kind]");
    if (kindBtn) {
      logKind = kindBtn.dataset.kind;
      document.querySelectorAll(".pill[data-kind]").forEach((b) => b.classList.toggle("on", b === kindBtn));
      return;
    }
    if (e.target.id === "crmLog") {
      const payload = { kind: logKind, body: document.getElementById("crmLogBody").value };
      const next = document.getElementById("crmLogNext").value;
      if (next) payload.next_followup = next;
      await api("/api/admin/crm/contacts/" + openId + "/activity", { method: "POST", body: JSON.stringify(payload) });
      openDrawer(openId); loadToday(); return;
    }
  });

  let t;
  root.addEventListener("input", (e) => {
    if (e.target.id !== "crmSearch") return;
    clearTimeout(t);
    t = setTimeout(() => { query = e.target.value.trim(); loadList(); }, 250);
  });

  window.crmInit = () => { renderPills(); loadToday(); loadList(); };
})();
