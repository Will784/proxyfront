(function (global) {
  'use strict';

  const DOMAINS = {
    SECURITY: { path: 'security', label: 'Seguridad' },
    INGESTION: { path: 'ingestion', label: 'Ingesta' },
    TRACE: { path: 'trace', label: 'Trazas pesadas' },
    ANALYTICS: { path: 'analytics', label: 'Analítica' }
  };
  const ROLES = [
    { id: 'ADMIN', label: 'Administrador' },
    { id: 'ANALYST', label: 'Analista' },
    { id: 'SERVICE', label: 'Servicio' },
    { id: 'GUEST', label: 'Invitado' }
  ];
  const METRIC_LABELS = {
    calls: 'Llamadas', granted: 'Permitidas', denied: 'Denegadas', masked: 'Enmascaradas',
    accepted: 'Aceptados', rejected: 'Rechazados', throttled: 'Limitados', duplicates: 'Repetidos',
    cacheHits: 'Aciertos de caché', cacheMisses: 'Fallos de caché', cachedEntries: 'En caché',
    statsHits: 'Aciertos', statsMisses: 'Cálculos', invalidations: 'Descartes por escritura'
  };
  const VERDICTS = {
    ALLOWED: { label: 'Permitido', css: 'ok' }, DENIED: { label: 'Denegado', css: 'deny' },
    THROTTLED: { label: 'Limitado', css: 'limit' }, REJECTED: { label: 'Rechazado', css: 'deny' },
    DUPLICATE: { label: 'Repetido', css: 'limit' }
  };
  const STATUS_TO_VERDICT = { 403: 'DENIED', 429: 'THROTTLED', 400: 'REJECTED', 409: 'DUPLICATE' };
  const BURST_SIZE = 15;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (selector, root = document) => root.querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const timeOf = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  class DashboardApp {
    constructor(config) {
      this.config = config;
      this.identity = { role: 'ADMIN', clientId: 'panel-web' };
      this.api = new global.LogHub.ApiClient(config.apiBaseUrl, this.identity);
      this.selected = 'SECURITY';
      this.overview = [];
      this.dialogDomain = null;
    }

    start() {
      this.renderRoles();
      $('#clientId').addEventListener('input', (e) => { this.identity.clientId = e.target.value.trim() || 'anonimo'; });
      $('#lanes').addEventListener('click', (e) => this.onLaneClick(e));
      $('#detail').addEventListener('click', (e) => this.onDetailClick(e));
      $('#logForm').addEventListener('submit', (e) => this.onSubmitLog(e));
      $('#cancelDialog').addEventListener('click', () => $('#logDialog').close());
      this.refreshAll();
      setInterval(() => this.refreshAll(), this.config.refreshIntervalMs);
    }

    /* ---------- identity ---------- */
    renderRoles() {
      const box = $('#roleSelector');
      box.innerHTML = ROLES.map((r) => `<button type="button" role="radio" data-role="${r.id}" aria-checked="${r.id === this.identity.role}">${r.label}</button>`).join('');
      box.addEventListener('click', (e) => {
        const button = e.target.closest('button[data-role]');
        if (!button) return;
        this.identity.role = button.dataset.role;
        box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
        this.toast('Ahora actúas como ' + button.textContent.toLowerCase() + '.');
        this.loadDetail();
      });
    }

    /* ---------- refresh ---------- */
    async refreshAll() {
      await this.refreshOverview();
      await this.loadDetail();
    }

    async refreshOverview() {
      try {
        const [overview, audit] = await Promise.all([this.api.overview(), this.api.audit()]);
        this.overview = overview;
        this.renderLanes();
        this.renderAudit(audit);
      } catch (error) {
        $('#lanes').innerHTML = `<p class="empty">${esc(error.message)}</p>`;
      }
    }

    /* ---------- lanes ---------- */
    renderLanes() {
      const host = $('#lanes');
      this.overview.forEach((item) => {
        let lane = $(`.lane[data-domain="${item.domain}"]`, host);
        if (!lane) {
          lane = document.createElement('article');
          lane.className = 'lane';
          lane.dataset.domain = item.domain;
          lane.innerHTML = this.laneSkeleton(item);
          host.appendChild(lane);
        }
        lane.classList.toggle('selected', item.domain === this.selected);
        $('.duty', lane).textContent = item.responsibility;
        $('.metrics', lane).innerHTML = Object.entries(item.metrics)
          .map(([key, value]) => `<li><b>${value}</b> ${esc(METRIC_LABELS[key] || key)}</li>`).join('');
      });
    }

    laneSkeleton(item) {
      const meta = DOMAINS[item.domain];
      return `
        <header>
          <div><h2>${meta.label}</h2><span class="kind">${esc(item.proxyKind)}</span></div>
          <button class="ghost" data-act="select">Ver registros</button>
        </header>
        <p class="duty"></p>
        <div class="track">
          <div class="node client">Cliente</div>
          <div class="node gate"><strong>${esc(item.proxyName)}</strong><em class="stamp"></em></div>
          <div class="node real">Servicio real</div>
          <i class="packet"></i>
        </div>
        <ul class="metrics"></ul>
        <footer>
          <button class="primary" data-act="send">Enviar log</button>
          <button class="ghost" data-act="burst">Ráfaga de ${BURST_SIZE}</button>
        </footer>`;
    }

    onLaneClick(event) {
      const button = event.target.closest('button[data-act]');
      const lane = event.target.closest('.lane');
      if (!lane) return;
      const domain = lane.dataset.domain;
      if (!button || button.dataset.act === 'select') return this.select(domain);
      if (button.dataset.act === 'send') return this.openDialog(domain);
      if (button.dataset.act === 'burst') return this.burst(domain);
    }

    select(domain) {
      this.selected = domain;
      this.renderLanes();
      this.loadDetail();
    }

    /* ---------- sending ---------- */
    openDialog(domain) {
      this.dialogDomain = domain;
      $('#dialogTitle').textContent = 'Enviar un log a ' + DOMAINS[domain].label.toLowerCase();
      $('#logDialog').showModal();
    }

    async onSubmitLog(event) {
      event.preventDefault();
      const data = new FormData(event.target);
      const body = { source: data.get('source'), level: data.get('level'), message: data.get('message'), payload: data.get('payload') || null };
      const domain = this.dialogDomain;
      $('#logDialog').close();
      this.select(domain);
      const outcome = await this.sendWithAnimation(domain, body);
      this.toast(outcome.ok ? 'Log aceptado por ' + DOMAINS[domain].label.toLowerCase() + '.' : outcome.error.message);
      this.refreshAll();
    }

    async burst(domain) {
      this.select(domain);
      const stamp = Date.now();
      const requests = Array.from({ length: BURST_SIZE }, (_, i) => this.api.send(DOMAINS[domain].path, {
        source: 'burst-demo', level: 'INFO', message: `Ráfaga ${stamp} mensaje ${i + 1}`, payload: null
      }));
      const approach = this.animate(domain, 'approach');
      const results = await Promise.allSettled(requests);
      await approach;
      const accepted = results.filter((r) => r.status === 'fulfilled').length;
      const blocked = results.find((r) => r.status === 'rejected');
      this.stampLane(domain, blocked ? STATUS_TO_VERDICT[blocked.reason.status] || 'REJECTED' : 'ALLOWED');
      await this.animate(domain, accepted > 0 ? 'pass' : 'blocked');
      this.toast(`${accepted} de ${BURST_SIZE} logs aceptados; ${BURST_SIZE - accepted} frenados por el proxy.`);
      this.refreshAll();
    }

    async sendWithAnimation(domain, body) {
      const approach = this.animate(domain, 'approach');
      let outcome;
      try {
        outcome = { ok: true, saved: await this.api.send(DOMAINS[domain].path, body) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      await approach;
      const verdict = outcome.ok ? 'ALLOWED' : (STATUS_TO_VERDICT[outcome.error.status] || 'REJECTED');
      this.stampLane(domain, verdict);
      await this.animate(domain, outcome.ok ? 'pass' : 'blocked');
      return outcome;
    }

    /* ---------- animation ---------- */
    laneEl(domain) { return $(`.lane[data-domain="${domain}"]`); }

    stampLane(domain, verdict) {
      const lane = this.laneEl(domain);
      const stamp = $('.stamp', lane);
      stamp.textContent = VERDICTS[verdict].label;
      stamp.className = 'stamp show ' + VERDICTS[verdict].css;
    }

    animate(domain, phase) {
      const track = $('.track', this.laneEl(domain));
      track.removeAttribute('data-phase');
      void track.offsetWidth; // restart CSS animation
      track.dataset.phase = phase;
      return sleep(phase === 'approach' ? 650 : 900).then(() => {
        if (phase !== 'approach') {
          setTimeout(() => { track.removeAttribute('data-phase'); $('.stamp', this.laneEl(domain)).className = 'stamp'; }, 1200);
        }
      });
    }

    /* ---------- detail panel ---------- */
    async loadDetail() {
      const panel = $('#detail');
      const meta = DOMAINS[this.selected];
      try {
        const [logs, stats] = await Promise.all([this.api.recent(meta.path), this.api.stats(meta.path)]);
        panel.innerHTML = `
          <h2>Registros de ${meta.label.toLowerCase()}</h2>
          ${this.renderBars(stats)}
          ${logs.length ? `<ul class="logs">${logs.map((l) => this.renderLogRow(l)).join('')}</ul>`
                        : '<p class="empty">Aún no hay logs aquí. Envía uno con el botón de la compuerta.</p>'}
          <div id="logOpen" class="log-open"></div>`;
      } catch (error) {
        panel.innerHTML = `<h2>Registros de ${meta.label.toLowerCase()}</h2><p class="empty blocked">${esc(error.message)}</p>`;
      }
    }

    renderBars(stats) {
      const max = Math.max(1, ...Object.values(stats.byLevel));
      const bars = Object.entries(stats.byLevel).map(([level, total]) =>
        `<div class="bar" title="${level}: ${total}"><span style="height:${Math.round((total / max) * 100)}%"></span><small>${level.slice(0, 4)}</small><b>${total}</b></div>`).join('');
      return `<div class="bars" aria-label="Logs por nivel, total ${stats.total}">${bars}</div>`;
    }

    renderLogRow(log) {
      const size = log.payloadSize ? `<small>${(log.payloadSize / 1024).toFixed(1)} KB</small>` : '';
      return `<li><button data-log="${log.id}"><span class="lvl ${esc(log.level)}">${esc(log.level)}</span>
        <span class="msg">${esc(log.message)}</span>${size}<time>${timeOf(log.createdAt)}</time></button></li>`;
    }

    async onDetailClick(event) {
      const button = event.target.closest('button[data-log]');
      if (!button) return;
      const meta = DOMAINS[this.selected];
      const before = this.metricOf(this.selected, 'cacheHits');
      const target = $('#logOpen');
      try {
        const log = await this.api.detail(meta.path, button.dataset.log);
        await this.refreshOverview();
        const origin = before === null ? '' : (this.metricOf(this.selected, 'cacheHits') > before
          ? '<span class="origin hit">Servido desde la caché del proxy</span>'
          : '<span class="origin miss">Cargado desde la base de datos</span>');
        target.innerHTML = `${origin}<dl>
          <dt>Origen</dt><dd>${esc(log.source)}</dd><dt>IP</dt><dd>${esc(log.sourceIp || '—')}</dd></dl>
          <pre>${esc(log.payload || 'Este log no tiene payload.')}</pre>`;
      } catch (error) {
        target.innerHTML = `<p class="empty blocked">${esc(error.message)}</p>`;
      }
    }

    metricOf(domain, key) {
      const item = this.overview.find((o) => o.domain === domain);
      return item && key in item.metrics ? item.metrics[key] : null;
    }

    /* ---------- audit + toast ---------- */
    renderAudit(events) {
      $('#audit').innerHTML = events.length ? events.map((e) => {
        const verdict = VERDICTS[e.verdict];
        return `<li class="${verdict.css}"><b>${verdict.label}</b> ${esc(DOMAINS[e.domain].label)} · ${esc(e.action)}
          <span>${esc(e.clientId)} como ${esc(e.role)} a las ${timeOf(e.at)}</span><em>${esc(e.detail)}</em></li>`;
      }).join('') : '<li class="empty">Todavía no hay decisiones. Envía un log para ver qué hace cada proxy.</li>';
    }

    toast(message) {
      const el = $('#toast');
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
    }
  }

  document.addEventListener('DOMContentLoaded', () => new DashboardApp(global.APP_CONFIG).start());
})(window);
