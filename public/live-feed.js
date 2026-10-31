/**
 * Spider-Sense live feed
 * Shared polling controller and browser-alert helper used by both portals.
 * Polling keeps the app serverless-friendly and needs no streaming endpoint.
 */
(function (root) {
  'use strict';

  const ALERTS_KEY = 'spider_browser_alerts';
  const MIN_INTERVAL = 5000;

  const idOf = item => String(item && (item._id || item.id) || '');
  const signatureOf = item =>
    [
      item.status || '',
      item.updatedAt || item.updated_at || '',
      item.heroName || item.hero_id || item.hero || ''
    ].join('|');

  function readSeen(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (error) {
      return {};
    }
  }

  function writeSeen(key, seen) {
    try {
      const entries = Object.entries(seen).slice(-250);
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    } catch (error) {
      // Storage can be unavailable in private mode; live updates still work.
    }
  }

  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `${minutes}m ago`;
  }

  /**
   * Create a polling feed. The caller supplies the fetch and render functions
   * so this module does not need to know the role or the active filters.
   */
  function createFeed(options) {
    const opts = options || {};
    const interval = Math.max(MIN_INTERVAL, Number(opts.interval) || 12000);
    const storageKey = opts.storageKey || 'spider_live_seen';
    const fetchItems = opts.fetchItems;
    const onData = opts.onData || function () {};
    const onChanges = opts.onChanges || function () {};
    const onStatus = opts.onStatus || function () {};
    const onError = opts.onError || function () {};

    if (typeof fetchItems !== 'function') {
      throw new Error('SiteLive.createFeed requires a fetchItems function.');
    }

    let stopped = true;
    let timer = null;
    let controller = null;
    let failures = 0;
    let baseline = null;
    let lastUpdatedAt = 0;
    let startedAt = 0;
    let seen = readSeen(storageKey);

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = delay => {
      clearTimer();
      if (stopped || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, Math.max(MIN_INTERVAL, delay || interval));
    };

    const emitStatus = (state, extra) => {
      lastUpdatedAt = state === 'live' ? Date.now() : lastUpdatedAt;
      onStatus({
        state,
        at: lastUpdatedAt,
        age: lastUpdatedAt ? relativeTime(lastUpdatedAt) : '',
        ...(extra || {})
      });
    };

    const seed = items => {
      baseline = new Map();
      seen = {};
      items.forEach(item => {
        const id = idOf(item);
        if (!id) return;
        const signature = signatureOf(item);
        baseline.set(id, signature);
        seen[id] = signature;
      });
      writeSeen(storageKey, seen);
    };

    async function load(settings) {
      const config = settings || {};
      if (stopped || controller) return;

      clearTimer();
      controller = new AbortController();
      if (config.silent !== true) emitStatus('loading');

      try {
        const items = await fetchItems(controller.signal);
        const list = Array.isArray(items) ? items.filter(item => idOf(item)) : [];
        controller = null;

        const initial = baseline === null || config.reset === true;
        if (initial) {
          seed(list);
          onData(list, { initial: true, changed: false });
          failures = 0;
          emitStatus('live');
          schedule(interval);
          return;
        }

        const added = [];
        const updated = [];
        const next = new Map();

        list.forEach(item => {
          const id = idOf(item);
          const signature = signatureOf(item);
          next.set(id, signature);
          if (!baseline.has(id)) {
            added.push(item);
          } else if (baseline.get(id) !== signature) {
            updated.push(item);
          }
          seen[id] = signature;
        });

        baseline = next;
        writeSeen(storageKey, seen);

        if (added.length || updated.length) {
          onData(list, { initial: false, changed: true, added, updated });
          onChanges({ added, updated, items: list });
        }

        failures = 0;
        emitStatus('live');
        schedule(interval);
      } catch (error) {
        controller = null;
        if (error && error.name === 'AbortError') return;
        failures += 1;
        emitStatus('offline', { error });
        onError(error);
        schedule(Math.min(60000, interval * Math.pow(2, Math.min(failures, 3))));
      }
    }

    function start() {
      if (!stopped) return;
      stopped = false;
      startedAt = Date.now();
      document.addEventListener('visibilitychange', onVisibility);
      if (document.hidden) {
        emitStatus('paused');
      } else {
        load({ reset: baseline === null });
      }
    }

    function stop() {
      stopped = true;
      clearTimer();
      if (controller) {
        controller.abort();
        controller = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
    }

    function onVisibility() {
      if (document.hidden) {
        clearTimer();
        emitStatus('paused');
      } else {
        load();
      }
    }

    function refresh(settings) {
      const config = settings || {};
      if (stopped) start();
      else load({ reset: config.reset === true, silent: config.silent === true });
    }

    function clearSeen() {
      seen = {};
      baseline = null;
      try {
        localStorage.removeItem(storageKey);
      } catch (error) {}
    }

    return {
      start,
      stop,
      refresh,
      clearSeen,
      get startedAt() {
        return startedAt;
      },
      get lastUpdatedAt() {
        return lastUpdatedAt;
      }
    };
  }

  // ── Browser alert preference ───────────────────────────────────────────
  const supported = typeof root.Notification !== 'undefined';

  function alertsEnabled() {
    try {
      return localStorage.getItem(ALERTS_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function setAlertsEnabled(value) {
    try {
      if (value) localStorage.setItem(ALERTS_KEY, '1');
      else localStorage.removeItem(ALERTS_KEY);
    } catch (error) {}
  }

  function permission() {
    return supported ? root.Notification.permission : 'unsupported';
  }

  function updateButton(button) {
    if (!button) return;
    if (!supported) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    const enabled = alertsEnabled() && permission() === 'granted';
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('is-on', enabled);
    const label = button.querySelector('[data-alert-label]');
    if (label) label.textContent = enabled ? 'Alerts on' : 'Enable alerts';
    button.title = enabled
      ? 'Browser alerts are enabled'
      : 'Get a browser notification for important incident updates';
  }

  async function requestPermission() {
    if (!supported) return 'unsupported';
    if (root.Notification.permission === 'granted') {
      setAlertsEnabled(true);
      return 'granted';
    }
    if (root.Notification.permission === 'denied') return 'denied';
    try {
      const result = await root.Notification.requestPermission();
      if (result === 'granted') setAlertsEnabled(true);
      return result;
    } catch (error) {
      return 'denied';
    }
  }

  function bindButton(button, onResult) {
    if (!button) return;
    updateButton(button);
    button.addEventListener('click', async () => {
      if (alertsEnabled() && permission() === 'granted') {
        setAlertsEnabled(false);
        updateButton(button);
        if (onResult) onResult('off');
        return;
      }
      const result = await requestPermission();
      updateButton(button);
      if (onResult) onResult(result);
    });
  }

  function show(title, body) {
    if (!supported || !alertsEnabled() || root.Notification.permission !== 'granted') {
      return false;
    }
    try {
      const notification = new root.Notification(title, {
        body,
        icon: '/favicon.png',
        badge: '/favicon.png',
        tag: 'spider-sense-incident',
        renotify: false
      });
      notification.onclick = () => {
        try {
          root.focus();
          notification.close();
        } catch (error) {}
      };
      return true;
    } catch (error) {
      return false;
    }
  }

  root.SiteLive = {
    createFeed,
    relativeTime,
    alerts: {
      supported,
      enabled: alertsEnabled,
      permission,
      updateButton,
      bindButton,
      requestPermission,
      show
    }
  };
})(typeof window !== 'undefined' ? window : this);
