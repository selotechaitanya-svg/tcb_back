/**
 * Spider-Sense motion system
 * Starts the Predictive Arc background, wires Lenis smooth scrolling into
 * GSAP's ticker, and supplies the page entrances / scroll reveals used by the
 * four static portals. All motion is skipped for prefers-reduced-motion.
 */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // The background is independent of the animation libraries: start it first
  // so a blocked/failed GSAP load never leaves the page with a flat backdrop.
  if (typeof window.initPredictiveArc === 'function') {
    window.initPredictiveArc({
      background: '#05070b',
      baseColor: '#DE443B',
      accentColor: '#FF9898',
      highlight: '#FF6B62',
      density: 78,
      dotSize: 102,
      speed: 100,
      arch: {
        peak: 100,
        archHeight: 0,
        thickness: 206,
        falloff: 600
      },
      pointer: {
        enabled: true,
        radius: 236,
        strength: 34
      }
    });
  }

  const siteMotion = {
    refresh: function () {},
    panel: function () {}
  };
  window.SiteMotion = siteMotion;

  const hasGSAP = typeof window.gsap !== 'undefined';
  const hasScrollTrigger = typeof window.ScrollTrigger !== 'undefined';
  if (reduceMotion || !hasGSAP || !hasScrollTrigger) return;

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  // ── Lenis: native scroll, GSAP-driven frame loop ────────────────────────
  let lenisInstance = null;
  if (typeof window.Lenis === 'function') {
    try {
      const lenis = new window.Lenis({
        lerp: 0.09,
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 1.4,
        syncTouch: false,
        autoRaf: false
      });

      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(time => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      lenisInstance = lenis;
    } catch (error) {
      console.warn('[SpiderMotion] Lenis could not initialise:', error);
    }
  }

  const isAuthPage = /^\/(login|register)(\/|\.html|$)/.test(window.location.pathname);
  const isAdminPage = /^\/admin(\/|\.html|$)/.test(window.location.pathname);
  const isVisible = element => !!element && element.getClientRects().length > 0;

  const boot = () => {
    // ── Page entrance ─────────────────────────────────────────────────────
    const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (isAuthPage) {
      const brandHeader = document.querySelector('.brand-header');
      const authCard = document.querySelector('.auth-card');

      if (brandHeader) {
        intro.from(
          brandHeader,
          { y: 22, autoAlpha: 0, filter: 'blur(8px)', duration: 0.85, clearProps: 'all' },
          0
        );
      }
      if (authCard) {
        intro.from(
          authCard,
          { y: 34, autoAlpha: 0, scale: 0.985, filter: 'blur(10px)', duration: 1, clearProps: 'all' },
          0.1
        );
      }
    } else {
      const header = document.querySelector('header');
      const brandMarks = document.querySelectorAll('.brand-title > span');
      const guestBanner = document.getElementById('guest-banner');
      const mainCards = isAdminPage
        ? [document.querySelector('.hero-banner'), document.querySelector('.controls-bar')].filter(isVisible)
        : [document.getElementById('report-card') || document.querySelector('.card')].filter(isVisible);

      if (header) {
        intro.from(header, { y: -26, autoAlpha: 0, duration: 0.9, clearProps: 'all' }, 0);
      }
      if (brandMarks.length) {
        intro.from(
          brandMarks,
          { y: 10, autoAlpha: 0, duration: 0.55, stagger: 0.07, clearProps: 'all' },
          0.16
        );
      }
      if (isVisible(guestBanner)) {
        intro.from(
          guestBanner,
          { y: 26, autoAlpha: 0, filter: 'blur(8px)', duration: 0.9, clearProps: 'all' },
          0.12
        );
      }
      if (mainCards.length) {
        intro.from(
          mainCards,
          {
            y: 30,
            autoAlpha: 0,
            filter: 'blur(10px)',
            duration: 1,
            stagger: 0.1,
            clearProps: 'all'
          },
          0.24
        );
      }
    }

    // ── Static scroll reveals ────────────────────────────────────────────
    document.querySelectorAll('[data-reveal]').forEach(element => {
      gsap.from(element, {
        y: 26,
        autoAlpha: 0,
        duration: 0.8,
        ease: 'power2.out',
        clearProps: 'all',
        scrollTrigger: {
          trigger: element,
          start: 'top 90%',
          once: true
        }
      });
    });

    // ── Incident cards, including late async renders ─────────────────────
    // IntersectionObserver (rather than a scroll trigger per card) means a
    // refresh that replaces cards above the current scroll position never
    // leaves invisible cards behind.
    const revealedCards = new WeakSet();
    let cardObserver = null;

    const revealCard = card => {
      gsap.to(card, {
        y: 0,
        autoAlpha: 1,
        duration: 0.65,
        ease: 'power2.out',
        overwrite: true,
        clearProps: 'transform,opacity,visibility'
      });
    };

    const revealCards = () => {
      const cards = Array.from(document.querySelectorAll('.incident-card')).filter(
        card => !revealedCards.has(card)
      );
      if (!cards.length) return;

      if (!cardObserver && typeof IntersectionObserver === 'function') {
        cardObserver = new IntersectionObserver(
          entries => {
            entries.forEach(entry => {
              if (!entry.isIntersecting) return;
              cardObserver.unobserve(entry.target);
              revealCard(entry.target);
            });
          },
          { rootMargin: '0px 0px -8% 0px', threshold: 0.01 }
        );
      }

      const viewportBottom = window.innerHeight * 0.92;
      cards.forEach((card, index) => {
        revealedCards.add(card);
        const rect = card.getBoundingClientRect();
        const inView = rect.top < viewportBottom && rect.bottom > 0;

        gsap.set(card, { y: 24, autoAlpha: 0 });

        if (inView) {
          gsap.to(card, {
            y: 0,
            autoAlpha: 1,
            duration: 0.65,
            delay: Math.min(index, 6) * 0.05,
            ease: 'power2.out',
            overwrite: true,
            clearProps: 'transform,opacity,visibility'
          });
        } else if (cardObserver) {
          cardObserver.observe(card);
        } else {
          revealCard(card);
        }
      });
    };

    siteMotion.refresh = () => {
      if (lenisInstance) lenisInstance.resize();
      revealCards();
      ScrollTrigger.refresh();
    };

    siteMotion.panel = element => {
      if (!element) return;
      gsap.killTweensOf(element);
      gsap.fromTo(
        element,
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.3,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility'
        }
      );
    };

    revealCards();
    ScrollTrigger.refresh();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
