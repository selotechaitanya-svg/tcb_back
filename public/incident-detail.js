/**
 * Spider-Sense incident detail dialog
 * Fetches the incident and its audit trail on demand and renders with DOM text
 * nodes, so incident content never becomes executable markup.
 */
(function (root) {
  'use strict';

  let overlay = null;
  let dialog = null;
  let body = null;
  let closeButton = null;
  let lastFocused = null;
  let currentId = null;
  let requestToken = 0;
  let requestController = null;

  const text = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  };

  const formatDate = value => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const statusClass = value =>
    String(value || 'Reported')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '');

  const getToken = () => {
    try {
      return localStorage.getItem('spider_token') || '';
    } catch (error) {
      return '';
    }
  };

  function ensureDialog() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'incident-detail-root';
    overlay.className = 'detail-overlay';
    overlay.hidden = true;

    dialog = document.createElement('div');
    dialog.className = 'detail-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'detail-heading');
    dialog.setAttribute('tabindex', '-1');

    const header = document.createElement('div');
    header.className = 'detail-header';
    const eyebrow = text('span', 'detail-eyebrow', 'Incident briefing');
    closeButton = text('button', 'detail-close', '\u00d7');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close incident details');
    closeButton.addEventListener('click', close);
    header.append(eyebrow, closeButton);

    body = document.createElement('div');
    body.className = 'detail-body';
    body.id = 'detail-body';

    dialog.append(header, body);
    overlay.append(dialog);
    document.body.append(overlay);

    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(event) {
    if (!overlay || overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function lockScroll(lock) {
    document.documentElement.classList.toggle('detail-open', lock);
    document.body.classList.toggle('detail-open', lock);
    if (root.SiteMotion && typeof root.SiteMotion.lockScroll === 'function') {
      root.SiteMotion.lockScroll(lock);
    }
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    requestToken += 1;
    if (requestController) {
      requestController.abort();
      requestController = null;
    }
    overlay.hidden = true;
    currentId = null;
    lockScroll(false);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    lastFocused = null;
  }

  function renderLoading() {
    body.replaceChildren();
    const wrap = text('div', 'detail-loading');
    wrap.append(text('span', 'detail-spinner'), text('p', '', 'Loading incident briefing\u2026'));
    body.append(wrap);
  }

  function renderError(message) {
    body.replaceChildren();
    const wrap = text('div', 'detail-error');
    wrap.append(
      text('h3', '', 'Could not load this incident'),
      text('p', '', message || 'Please try again.'),
      (() => {
        const retry = text('button', 'btn btn-secondary btn-sm', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', () => {
          if (currentId) open(currentId);
        });
        return retry;
      })()
    );
    body.append(wrap);
  }

  function field(label, value) {
    const row = text('div', 'detail-field');
    row.append(text('span', 'detail-label', label), text('strong', 'detail-value', value || 'Not provided'));
    return row;
  }

  function render(detail, history) {
    const incident = detail && detail.incident ? detail.incident : detail || {};
    const entries = Array.isArray(history) ? history : [];
    body.replaceChildren();

    const summary = text('div', 'detail-summary');
    const badges = text('div', 'detail-badges');
    badges.append(
      text('span', `severity-badge sev-${Number(incident.severity) || 0}`, `Threat Lvl ${incident.severity || '?'}`),
      text('span', `status-badge st-${statusClass(incident.status)}`, incident.status || 'Reported')
    );
    summary.append(badges);
    summary.append(text('h2', 'detail-title', incident.title || 'Untitled incident'));
    summary.append(text('p', 'detail-description', incident.description || 'No description provided.'));
    body.append(summary);

    const grid = text('div', 'detail-grid');
    grid.append(
      field('Category', incident.category),
      field('Location', incident.location),
      field('Reported by', incident.reporterName || incident.reporter_name || 'Citizen'),
      field('Assigned hero', incident.heroName || incident.hero_name || 'Awaiting response'),
      field('Reported', formatDate(incident.createdAt || incident.created_at)),
      field('Last update', formatDate(incident.updatedAt || incident.updated_at))
    );
    body.append(grid);

    const timeline = text('section', 'detail-timeline');
    timeline.append(text('h3', '', 'Response timeline'));
    if (!entries.length) {
      timeline.append(text('p', 'detail-empty', 'No status transitions recorded yet.'));
    } else {
      const list = text('ol', 'timeline-list');
      entries
        .slice()
        .sort((a, b) => new Date(a.changed_at || a.changedAt || 0) - new Date(b.changed_at || b.changedAt || 0))
        .forEach(entry => {
          const item = text('li', 'timeline-item');
          const dot = text('span', 'timeline-dot');
          const copy = text('div', 'timeline-copy');
          const transition = text('div', 'timeline-transition');
          transition.append(
            text('strong', '', entry.previous_status || entry.previousStatus || 'Reported'),
            text('span', 'timeline-arrow', '\u2192'),
            text('strong', '', entry.new_status || entry.newStatus || 'Update')
          );
          const meta = text('div', 'timeline-meta');
          meta.append(
            text('span', '', formatDate(entry.changed_at || entry.changedAt)),
            text('span', '', entry.changed_by_name || entry.changedByName || 'System')
          );
          copy.append(transition, meta);
          if (entry.notes) copy.append(text('p', 'timeline-notes', entry.notes));
          item.append(dot, copy);
          list.append(item);
        });
      timeline.append(list);
    }
    body.append(timeline);
  }

  async function open(id) {
    ensureDialog();
    currentId = id;
    lastFocused = document.activeElement;
    overlay.hidden = false;
    lockScroll(true);
    renderLoading();
    dialog.focus();

    const token = getToken();
    if (!token) {
      renderError('Please sign in again to view this incident.');
      return;
    }

    requestToken += 1;
    const tokenForRequest = requestToken;
    if (requestController) requestController.abort();
    requestController = new AbortController();

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [detailResponse, historyResponse] = await Promise.all([
        fetch(`/api/incidents/${encodeURIComponent(id)}`, {
          headers,
          signal: requestController.signal
        }),
        fetch(`/api/incidents/${encodeURIComponent(id)}/history`, {
          headers,
          signal: requestController.signal
        })
      ]);

      const detail = await detailResponse.json();
      const historyPayload = historyResponse.ok ? await historyResponse.json() : null;

      if (!detailResponse.ok) {
        throw new Error(detail.error || 'Incident could not be loaded.');
      }
      if (tokenForRequest !== requestToken || overlay.hidden) return;

      const history = Array.isArray(historyPayload)
        ? historyPayload
        : (historyPayload && (historyPayload.history || historyPayload.items)) ||
          detail.statusHistory ||
          detail.history ||
          [];

      render(detail, history);
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (tokenForRequest !== requestToken || overlay.hidden) return;
      renderError(error.message);
    }
  }

  root.IncidentDetail = { open, close };
})(typeof window !== 'undefined' ? window : this);
