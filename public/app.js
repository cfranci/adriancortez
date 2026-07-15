// Header state + scroll reveals + KV-content hydration + lead form
const bar = document.getElementById('topbar');
const onScroll = () => bar.classList.toggle('solid', window.scrollY > 40);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }),
  { threshold: 0.12 }
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// ---------- content hydration (admin-published content overrides baked-in HTML) ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

fetch('/api/content')
  .then((r) => (r.ok ? r.json() : null))
  .then((c) => {
    if (!c) return;
    if (c.heroSub) {
      document.querySelector('.hero-sub').innerHTML = esc(c.heroSub) + (c.heroEm ? ' <em>' + esc(c.heroEm) + '</em>' : '');
    }
    if (c.listTitle) document.querySelector('#listings h2').textContent = c.listTitle;
    if (c.listSub) document.querySelector('#listings .section-sub').textContent = c.listSub;
    if (Array.isArray(c.listings) && c.listings.length) {
      document.querySelector('.stack').innerHTML = c.listings.map((l) => `
        <a class="stack-row reveal in" href="${esc(l.url || '#')}" target="_blank" rel="noopener">
          <span class="floor">${esc(l.floor)}</span>
          <span class="thumb">${l.img ? `<img src="${esc(l.img)}" alt="${esc(l.name)}" loading="lazy">` : ''}</span>
          <span class="unit">
            <span class="unit-name">${esc(l.name)}</span>
            <span class="unit-spec">${esc(l.spec)}</span>
          </span>
          <span class="price">${esc(l.price)}${l.per ? `<small>${esc(l.per)}</small>` : ''}</span>
          <span class="go" aria-hidden="true">&#8594;</span>
        </a>`).join('');
    }
    if (Array.isArray(c.solds) && c.solds.length) {
      document.querySelector('.ledger').innerHTML = c.solds.map((s) =>
        `<li><span>${esc(s.addr)}</span><i></i><b>${esc(s.price)}</b></li>`).join('');
    }
  })
  .catch(() => {}); // static fallback already rendered

// ---------- lead form ----------
const form = document.getElementById('leadForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Sending…';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error();
      form.innerHTML = '<p class="form-done">Sent. Adrian will text you back shortly.</p>';
    } catch {
      btn.disabled = false; btn.textContent = 'Send to Adrian';
      form.querySelector('.form-err').textContent = 'That didn’t go through. Call or text (954) 665-0665 instead.';
    }
  });
}

// ---------- sticky mobile CTA ----------
const sticky = document.getElementById('stickyCta');
if (sticky) {
  new IntersectionObserver(
    ([e]) => sticky.classList.toggle('show', !e.isIntersecting),
    { threshold: 0 }
  ).observe(document.querySelector('.hero'));
}
