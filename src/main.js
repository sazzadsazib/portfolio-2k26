import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './style.css';

gsap.registerPlugin(ScrollTrigger);

// Utility Selectors
const q = (s) => document.querySelector(s);
const qa = (s) => document.querySelectorAll(s);

// ============================================================================
// 01. HARDWARE-ACCELERATED VIDEO FRAME SCRUBBER (VELVETY SMOOTH DAMPING)
// ============================================================================
class SmoothVideoFrameScrubber {
  constructor(videoEl, onProgressUpdate) {
    this.video = videoEl;
    this.onProgressUpdate = onProgressUpdate;
    this.targetProgress = 0;
    this.currentProgress = 0;
    this.velocity = 0;
    this.lastTime = -1;
    this.fpsCounter = q('#fpsCounter');
    this.videoTimeEl = q('#videoTime');

    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();
    this.isLoopRunning = false;
    this.isSeeking = false;
    this.pendingTime = null;
    this.seekWatchdog = null;

    this.init();
  }

  init() {
    if (!this.video) return;

    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('muted', '');
    this.video.setAttribute('playsinline', '');
    this.video.preload = 'auto';

    // Hook requestVideoFrameCallback if available for compositor-synchronized painting
    const onFramePresented = () => {
      if ('requestVideoFrameCallback' in this.video) {
        this.video.requestVideoFrameCallback(onFramePresented);
      }
    };
    if ('requestVideoFrameCallback' in this.video) {
      this.video.requestVideoFrameCallback(onFramePresented);
    }

    // When the browser finishes decoding a seeked frame:
    this.video.addEventListener('seeked', () => {
      this.isSeeking = false;
      if (this.seekWatchdog) clearTimeout(this.seekWatchdog);

      if (this.videoTimeEl) {
        this.videoTimeEl.textContent = formatTime(this.video.currentTime);
      }

      // If a newer frame target was requested during seek, dispatch immediately
      if (this.pendingTime !== null) {
        const next = this.pendingTime;
        this.pendingTime = null;
        if (Math.abs(this.video.currentTime - next) > 0.018) {
          this.executeSeek(next);
        }
      }
    });

    const start = () => {
      // Prime decoder pipeline smoothly to a visible initial frame
      try {
        this.video.currentTime = 0.05;
        const playPromise = this.video.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            this.video.pause();
            this.video.currentTime = 0.05;
          }).catch(() => {});
        }
      } catch (e) {}

      if (!this.isLoopRunning) {
        this.isLoopRunning = true;
        this.startLoop();
      }
    };

    if (this.video.readyState >= 1 && this.video.duration) {
      start();
    } else {
      this.video.addEventListener('loadedmetadata', start, { once: true });
      this.video.addEventListener('canplay', start, { once: true });
      this.video.load();
    }
  }

  executeSeek(time) {
    if (!this.video || !this.video.duration || isNaN(this.video.duration)) return;
    const maxDur = Math.max(0.1, this.video.duration - 0.05);
    const clampedTime = Math.max(0.02, Math.min(maxDur, time));

    this.isSeeking = true;

    // Safety watchdog: auto-unlock isSeeking after 80ms if browser drops seeked event
    if (this.seekWatchdog) clearTimeout(this.seekWatchdog);
    this.seekWatchdog = setTimeout(() => {
      this.isSeeking = false;
      if (this.pendingTime !== null) {
        const nextFallback = this.pendingTime;
        this.pendingTime = null;
        this.executeSeek(nextFallback);
      }
    }, 80);

    try {
      if (typeof this.video.fastSeek === 'function') {
        this.video.fastSeek(clampedTime);
      } else {
        this.video.currentTime = clampedTime;
      }
    } catch (e) {
      this.video.currentTime = clampedTime;
    }
  }

  setProgress(p) {
    this.targetProgress = Math.max(0, Math.min(1, p));
  }

  startLoop() {
    const loop = (now) => {
      // FPS measurement
      this.frameCount++;
      if (now - this.lastFpsUpdate >= 1000) {
        if (this.fpsCounter) {
          const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
          this.fpsCounter.textContent = `${fps} FPS · GPU`;
        }
        this.frameCount = 0;
        this.lastFpsUpdate = now;
      }

      // Velvety spring momentum smoothing (Apple-grade fluid glide)
      const diff = this.targetProgress - this.currentProgress;
      const smoothFactor = Math.abs(diff) > 0.06 ? 0.24 : 0.16;
      this.currentProgress += diff * smoothFactor;

      // Update work scoped timeline side card
      if (this.onProgressUpdate) {
        this.onProgressUpdate(this.currentProgress);
      }

      // Calculate video frame timestamp
      const dur = (this.video && this.video.duration && isFinite(this.video.duration)) ? this.video.duration : 10;
      const targetTime = this.currentProgress * dur;

      if (this.video && this.video.readyState >= 1) {
        const timeDiff = Math.abs(this.video.currentTime - targetTime);
        if (timeDiff > 0.022) {
          if (!this.isSeeking && !this.video.seeking) {
            this.executeSeek(targetTime);
          } else {
            this.pendingTime = targetTime;
          }
        }
      }

      if (this.videoTimeEl && Math.abs(targetTime - this.lastTime) > 0.03) {
        this.lastTime = targetTime;
        this.videoTimeEl.textContent = formatTime(targetTime);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ============================================================================
// 02. WORK SCOPED TIMELINE SIDE CARD MANAGER
// ============================================================================
class WorkScopedTimelineManager {
  constructor() {
    this.badgeEl = q('#scopeStageBadge');
    this.progressEl = q('#scopeProgressBar');
    this.companyEl = q('#scopeCompany');
    this.periodEl = q('#scopePeriod');
    this.titleEl = q('#scopeTitle');
    this.summaryEl = q('#scopeSummary');
    this.metricLbl1 = q('#scopeMetricLbl1');
    this.metricVal1 = q('#scopeMetricVal1');
    this.metricLbl2 = q('#scopeMetricLbl2');
    this.metricVal2 = q('#scopeMetricVal2');
    this.metricLbl3 = q('#scopeMetricLbl3');
    this.metricVal3 = q('#scopeMetricVal3');
    this.techPillsEl = q('#scopeTechPills');
    this.navBtns = qa('.scope-nav-btn');

    this.currentStageIdx = -1;

    this.stages = [
      {
        id: 1,
        range: [0.00, 0.40],
        badge: 'STAGE 01 / 03 · bKash (2021-Present)',
        company: 'bKash Limited',
        period: '2021 — Present · Assistant Lead',
        title: 'Team Lead · bKash Forest, IDS, G2P EFT & Self Service',
        summary: 'Team Lead for bKash Forest green platform (1.2M+ trees); architected IDS (Instant Disbursement), G2P EFT national fund distribution, and Merchant Self-Service platforms.',
        metrics: [
          { lbl: 'IMPACT', val: '1.2M+ Trees', color: 'text-red' },
          { lbl: 'THROUGHPUT', val: '5,000+ TPS', color: 'text-crimson' },
          { lbl: 'SOLUTIONS', val: 'IDS & G2P EFT', color: 'text-ruby' }
        ],
        tech: ['Go', 'Java Spring Boot', 'Kafka', 'Redis', 'Gamification', 'mTLS', 'PostgreSQL']
      },
      {
        id: 2,
        range: [0.40, 0.75],
        badge: 'STAGE 02 / 03 · Alice Labs (2018-2021)',
        company: 'Alice Labs Pte. Ltd. (Singapore)',
        period: '2018 — 2021 · 3 Years',
        title: 'AI Chatbot Builder & WhatsApp Solutions (Revora)',
        summary: 'Engineered the core visual AI Chatbot Builder, automated dialogue trees, NLP intent classifiers, and high-throughput WhatsApp solutions (flagship AI suite now branded as Revora).',
        metrics: [
          { lbl: 'SCALE', val: '10M+ Dialogues', color: 'text-red' },
          { lbl: 'ACCURACY', val: '98.7% Intent', color: 'text-crimson' },
          { lbl: 'PRODUCT', val: 'Revora AI Suite', color: 'text-ruby' }
        ],
        tech: ['Python', 'FastAPI', 'NLP Transformers', 'WhatsApp API', 'WebSockets', 'Revora AI']
      },
      {
        id: 3,
        range: [0.75, 1.00],
        badge: 'STAGE 03 / 03 · Mayalogy & BRAC Univ',
        company: 'Mayalogy Limited & BRAC University',
        period: '2012 — 2018',
        title: 'UI/UX Designer (Mayalogy 1 Yr) & B.Sc. in CSE (BRAC)',
        summary: 'UI/UX Designer for 1 year at Mayalogy creating healthcare Q&A UX flows helping thousands of users; built computer science & engineering foundations at BRAC University (2012-2016).',
        metrics: [
          { lbl: 'USERS', val: '100K+ Helped', color: 'text-red' },
          { lbl: 'ROLE', val: 'UI/UX Designer', color: 'text-crimson' },
          { lbl: 'ALUM', val: 'BRAC Univ CSE', color: 'text-ruby' }
        ],
        tech: ['UI/UX Design', 'User Research', 'Wireframing', 'Design Systems', 'Algorithms', 'CSE']
      }
    ];

    this.initClickNavigation();
  }

  initClickNavigation() {
    this.navBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const jumpTarget = parseFloat(btn.getAttribute('data-jump') || '0');
        const heroEl = q('.hero');
        if (heroEl) {
          const heroTop = heroEl.offsetTop;
          const heroHeight = heroEl.offsetHeight - window.innerHeight;
          const targetScroll = heroTop + (jumpTarget * heroHeight);
          window.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }
      });
    });
  }

  update(progress) {
    if (this.progressEl) {
      this.progressEl.style.width = `${Math.min(100, Math.max(5, progress * 100))}%`;
    }

    let matchedIdx = this.stages.findIndex((s) => progress >= s.range[0] && progress < s.range[1]);
    if (matchedIdx === -1) {
      matchedIdx = progress >= 0.75 ? 2 : 0;
    }

    if (matchedIdx !== this.currentStageIdx) {
      this.currentStageIdx = matchedIdx;
      this.renderStage(this.stages[matchedIdx], matchedIdx);
    }
  }

  renderStage(stage, idx) {
    if (this.badgeEl) this.badgeEl.textContent = stage.badge;
    if (this.companyEl) this.companyEl.textContent = stage.company;
    if (this.periodEl) this.periodEl.textContent = stage.period;
    if (this.titleEl) this.titleEl.textContent = stage.title;
    if (this.summaryEl) this.summaryEl.textContent = stage.summary;

    if (this.metricLbl1 && stage.metrics[0]) {
      this.metricLbl1.textContent = stage.metrics[0].lbl;
      this.metricVal1.textContent = stage.metrics[0].val;
      this.metricVal1.className = `sm-val ${stage.metrics[0].color}`;
    }
    if (this.metricLbl2 && stage.metrics[1]) {
      this.metricLbl2.textContent = stage.metrics[1].lbl;
      this.metricVal2.textContent = stage.metrics[1].val;
      this.metricVal2.className = `sm-val ${stage.metrics[1].color}`;
    }
    if (this.metricLbl3 && stage.metrics[2]) {
      this.metricLbl3.textContent = stage.metrics[2].lbl;
      this.metricVal3.textContent = stage.metrics[2].val;
      this.metricVal3.className = `sm-val ${stage.metrics[2].color}`;
    }

    if (this.techPillsEl) {
      this.techPillsEl.innerHTML = stage.tech.map((t) => `<span>${t}</span>`).join('');
    }

    this.navBtns.forEach((btn, bIdx) => {
      if (bIdx === idx) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

// ============================================================================
// 03. MAIN INITIALIZATION & GSAP TIMELINES
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  // Prevent browser scroll restoration jump
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);

  const loader = q('#loader');
  const loadPercent = q('#loadPercent');
  const progressBar = q('.loader-progress');
  const video = q('#scrollVideo');

  // Initialize Work Scoped Timeline Side Card
  const scopeManager = new WorkScopedTimelineManager();

  // Initialize Smooth Video Frame Scrubber
  const scrubber = new SmoothVideoFrameScrubber(video, (progress) => {
    scopeManager.update(progress);
  });

  // Initialize ScrollTrigger immediately on load so pin spacers are established without delay
  initScrollAnimations();

  // Preloader GSAP Simulation
  let progressVal = 0;
  const progressInterval = setInterval(() => {
    progressVal += Math.floor(Math.random() * 25) + 15;
    if (progressVal >= 100) {
      progressVal = 100;
      clearInterval(progressInterval);
      completePreloader();
    }
    if (progressBar) progressBar.style.width = `${progressVal}%`;
    if (loadPercent) loadPercent.textContent = `${progressVal}%`;
  }, 35);

  function completePreloader() {
    const tl = gsap.timeline({
      onComplete: () => {
        if (loader) loader.style.display = 'none';
        ScrollTrigger.refresh();
      }
    });

    tl.to(loader, {
      opacity: 0,
      duration: 0.5,
      ease: 'power3.inOut'
    })
    .from('.nav', {
      y: -30,
      opacity: 0,
      duration: 0.6,
      ease: 'power3.out'
    }, '-=0.2')
    .from('.hero-copy', {
      y: 35,
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out'
    }, '-=0.3')
    .from('.hero-scope-card', {
      x: 50,
      opacity: 0,
      duration: 0.8,
      ease: 'power3.out'
    }, '-=0.5');
  }

  // ==========================================================================
  // 04. ADVANCED GSAP SCROLLTRIGGER REVEAL & SCALE SUITE
  // ==========================================================================
  function initScrollAnimations() {
    // 1. Pinned Hero Section with Velvety Scroll Scrub
    ScrollTrigger.create({
      trigger: '.hero',
      start: 'top top',
      end: '+=320%',
      pin: '.hero-video-stage',
      scrub: 0.45,
      anticipatePin: 0,
      onUpdate: (self) => {
        scrubber.setProgress(self.progress);
      }
    });

    // 2. Global Section Headers Reveal (Staggered Badge, 3D Title, and Description)
    qa('.section-header').forEach((hdr) => {
      const badge = hdr.querySelector('.section-badge');
      const title = hdr.querySelector('.section-title');
      const desc = hdr.querySelector('.section-desc');

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: hdr,
          start: 'top 85%',
          toggleActions: 'play none none none'
        }
      });

      if (badge) {
        tl.from(badge, { x: -35, opacity: 0, scale: 0.8, duration: 0.65, ease: 'back.out(2.2)' });
      }
      if (title) {
        tl.from(title, { y: 40, opacity: 0, rotateX: 15, transformPerspective: 800, duration: 0.8, ease: 'power3.out' }, '-=0.4');
      }
      if (desc) {
        tl.from(desc, { y: 25, opacity: 0, duration: 0.7, ease: 'power2.out' }, '-=0.4');
      }
    });

    // 3. Career Timeline Fill & Staggered Cards Reveal with Scale
    const timelineFill = q('#timelineFill');
    if (timelineFill) {
      ScrollTrigger.create({
        trigger: '.journey-section',
        start: 'top 70%',
        end: 'bottom 80%',
        scrub: true,
        onUpdate: (self) => {
          timelineFill.style.height = `${self.progress * 100}%`;
        }
      });
    }

    qa('.timeline-card').forEach((card, idx) => {
      const isEven = idx % 2 === 0;
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: card,
          start: 'top 85%',
          toggleActions: 'play none none none'
        }
      });

      tl.from(card, {
        x: isEven ? -60 : 60,
        y: 45,
        rotateY: isEven ? 10 : -10,
        scale: 0.88,
        opacity: 0,
        duration: 0.9,
        ease: 'back.out(1.5)'
      });

      const hls = card.querySelectorAll('.highlight-box');
      if (hls.length) {
        tl.from(hls, {
          y: 20,
          opacity: 0,
          scale: 0.94,
          stagger: 0.08,
          duration: 0.55,
          ease: 'power2.out'
        }, '-=0.45');
      }
    });

    // 4. Featured Products (Projects) Dynamic Scale & Perspective Reveal
    qa('.project-showcase').forEach((item, idx) => {
      const isEven = idx % 2 === 0;
      const img = item.querySelector('.project-img');
      const stats = item.querySelectorAll('.p-stat');

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: item,
          start: 'top 85%',
          toggleActions: 'play none none none'
        }
      });

      tl.from(item, {
        y: 60,
        scale: 0.85,
        opacity: 0,
        rotateX: 8,
        transformPerspective: 1000,
        duration: 0.95,
        delay: idx * 0.08,
        ease: 'power3.out'
      });

      if (img) {
        tl.from(img, {
          scale: 1.18,
          duration: 1.2,
          ease: 'power2.out'
        }, '-=0.8');
      }

      if (stats.length) {
        tl.from(stats, {
          scale: 0.75,
          opacity: 0,
          y: 15,
          stagger: 0.07,
          duration: 0.5,
          ease: 'back.out(1.8)'
        }, '-=0.5');
      }
    });

    // 5. Architecture Simulator Diagram & Topology Nodes Staggered Pop
    const archDiag = q('.architecture-diagram');
    if (archDiag) {
      const archTl = gsap.timeline({
        scrollTrigger: {
          trigger: archDiag,
          start: 'top 80%',
          toggleActions: 'play none none none'
        }
      });

      archTl.from(archDiag, {
        scale: 0.92,
        y: 45,
        opacity: 0,
        duration: 0.85,
        ease: 'power3.out'
      })
      .from('.circuit-path', {
        strokeDashoffset: 120,
        opacity: 0,
        stagger: 0.1,
        duration: 0.9,
        ease: 'power2.out'
      }, '-=0.5')
      .from('.arch-node', {
        scale: 0.72,
        y: 30,
        opacity: 0,
        stagger: 0.08,
        duration: 0.7,
        ease: 'back.out(2)'
      }, '-=0.6');
    }

    // 6. Skills Grid Wave Pop-in with Dynamic Scale
    const skillsGrid = q('.skills-grid');
    if (skillsGrid) {
      gsap.from('.skill-card', {
        scale: 0.65,
        y: 35,
        opacity: 0,
        duration: 0.65,
        stagger: {
          amount: 0.45,
          from: 'center',
          grid: 'auto'
        },
        ease: 'back.out(2)',
        scrollTrigger: {
          trigger: skillsGrid,
          start: 'top 85%',
          toggleActions: 'play none none none'
        }
      });
    }

    // 7. Impact Dashboard Stats Scale & Counter Animation
    const impactGrid = q('.impact-grid');
    if (impactGrid) {
      const impactTl = gsap.timeline({
        scrollTrigger: {
          trigger: impactGrid,
          start: 'top 80%',
          toggleActions: 'play none none none'
        }
      });

      impactTl.from(impactGrid, {
        scale: 0.9,
        y: 40,
        opacity: 0,
        duration: 0.85,
        ease: 'power3.out'
      })
      .from('.impact-stat-box', {
        scale: 0.75,
        y: 25,
        opacity: 0,
        stagger: 0.12,
        duration: 0.75,
        ease: 'back.out(1.8)'
      }, '-=0.5');

      qa('.counter-num').forEach((counter) => {
        const target = parseFloat(counter.getAttribute('data-target') || '0');
        const decimals = parseInt(counter.getAttribute('data-decimals') || '0');
        const obj = { val: 0 };
        gsap.to(obj, {
          val: target,
          duration: 2.4,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: impactGrid,
            start: 'top 80%'
          },
          onUpdate: () => {
            counter.textContent = decimals > 0 ? obj.val.toFixed(decimals) : Math.round(obj.val).toLocaleString();
          }
        });
      });
    }

    // 8. Interactive Simulator Panel, Guide Banner, Triggers & Terminal
    const simPanel = q('.interactive-simulator-panel');
    if (simPanel) {
      gsap.timeline({
        scrollTrigger: {
          trigger: simPanel,
          start: 'top 85%',
          toggleActions: 'play none none none'
        }
      })
      .from(simPanel, {
        scale: 0.94,
        y: 35,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out'
      })
      .from('.sim-guide-banner', {
        y: 15,
        opacity: 0,
        duration: 0.5,
        ease: 'power2.out'
      }, '-=0.4')
      .from('.sim-trigger-card', {
        scale: 0.92,
        y: 20,
        opacity: 0,
        stagger: 0.08,
        duration: 0.6,
        ease: 'back.out(1.6)'
      }, '-=0.3')
      .from('.sim-terminal-col', {
        x: 25,
        opacity: 0,
        duration: 0.65,
        ease: 'power2.out'
      }, '-=0.5');
    }

    // 9. Contact Card & Action Boxes Reveal
    const contactCard = q('.contact-card');
    if (contactCard) {
      gsap.timeline({
        scrollTrigger: {
          trigger: contactCard,
          start: 'top 80%',
          toggleActions: 'play none none none'
        }
      })
      .from(contactCard, {
        scale: 0.9,
        y: 45,
        opacity: 0,
        duration: 0.9,
        ease: 'power3.out'
      })
      .from('.contact-action-box', {
        scale: 0.8,
        y: 25,
        opacity: 0,
        stagger: 0.12,
        duration: 0.75,
        ease: 'back.out(1.8)'
      }, '-=0.5');
    }

    // 10. Kinetic Marquee Velocity-Tied Parallax
    ScrollTrigger.create({
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        const velocity = Math.abs(self.getVelocity());
        const speedMultiplier = Math.min(3.2, 1 + velocity / 1200);
        qa('.marquee-track').forEach((track) => {
          track.style.animationDuration = `${32 / speedMultiplier}s`;
        });
      }
    });
  }

  // ==========================================================================
  // 05. NAVBAR SCROLL EFFECT & ACTIVE LINK TRACKER
  // ==========================================================================
  const mainNav = q('#mainNav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      mainNav.classList.add('scrolled');
    } else {
      mainNav.classList.remove('scrolled');
    }

    // Active Section Spy
    const sections = qa('section[id]');
    const scrollPos = window.scrollY + 180;

    sections.forEach((sec) => {
      const top = sec.offsetTop;
      const height = sec.offsetHeight;
      const id = sec.getAttribute('id');
      if (scrollPos >= top && scrollPos < top + height) {
        qa('.nav-link').forEach((link) => {
          if (link.getAttribute('data-nav') === id) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    });
  });

  // ==========================================================================
  // 06. ARCHITECTURE FLOW SIMULATOR & INTERACTIVE NODE INSPECTOR
  // ==========================================================================
  // Infinite circuit pulse dash offset loop
  gsap.to('.circuit-path', {
    strokeDashoffset: -40,
    duration: 1.8,
    repeat: -1,
    ease: 'none'
  });

  const nodeSpecs = {
    client: {
      title: '[ NODE INSPECTOR: 50M+ User Clients & Ingress ]',
      cluster: 'CLUSTER: #DHAKA-INGRESS-01',
      desc: 'High-concurrency ingress layer serving 50M+ bKash consumer mobile apps, USSD telco sessions, and merchant web portals with zero-trust mTLS encryption.',
      throughput: '48,200 req/s',
      latency: '11.8ms P99',
      replicas: '24 Pods (HPA)',
      uptime: '99.999% SLA',
      tech: ['HTTP/3 (QUIC)', 'mTLS', 'Envoy Proxy', 'Kubernetes HPA', 'Go Ingress'],
      payload: {
        node_id: "node-client-ingress",
        cluster: "DHAKA-INGRESS-NODE-01",
        active_sessions: 1428500,
        ingress_rate_rps: 48200,
        protocol: "HTTP/3_QUIC_mTLS",
        p99_latency_ms: 11.8,
        gateway_route: "/api/v2/disbursement/instant",
        encryption: "TLS_AES_256_GCM_SHA384",
        health_status: "HEALTHY_OPTIMAL"
      }
    },
    gateway: {
      title: '[ NODE INSPECTOR: API Gateway & Merchant Self-Service ]',
      cluster: 'CLUSTER: #DHAKA-GATEWAY-02',
      desc: 'Edge security cluster enforcing HMAC signature verification, merchant token verification, distributed rate-limiting, and instant merchant self-service onboarding.',
      throughput: '32,500 req/s',
      latency: '1.2ms P99',
      replicas: '18 Pods (K8s)',
      uptime: '99.999% SLA',
      tech: ['Kong Gateway', 'Envoy', 'HMAC-SHA256', 'Redis Cluster', 'OAuth 2.0 / JWT'],
      payload: {
        node_id: "node-api-gateway",
        cluster: "DHAKA-GATEWAY-02",
        auth_engine: "HMAC_SHA256_STRICT",
        rate_limit_bucket: "100K_PER_MINUTE",
        auth_latency_ms: 1.2,
        merchant_onboarding_speed: "1.4s_OCR_SYNC",
        active_connections: 84200,
        health_status: "HEALTHY_OPTIMAL"
      }
    },
    engine: {
      title: '[ NODE INSPECTOR: IDS & G2P EFT Batch Engine ]',
      cluster: 'CLUSTER: #DHAKA-FINTECH-CORE',
      desc: 'National disbursement engine executing high-throughput batch payments (5,000 TPS) with distributed Sagas, zero-loss idempotent ledgers, and automated bank network clearing.',
      throughput: '5,000 TPS Batch',
      latency: '34.2ms P99',
      replicas: '16 Clustered Pods',
      uptime: '99.999% SLA',
      tech: ['Java Spring Boot', 'Go Sagas', 'PostgreSQL Partitioning', 'Redis Sentinel', 'mTLS gRPC'],
      payload: {
        node_id: "node-ids-engine",
        cluster: "DHAKA-FINTECH-CORE",
        batch_mode: "INSTANT_DISBURSEMENT_5K_TPS",
        saga_state: "IDEMPOTENT_COMMITTED",
        p99_latency_ms: 34.2,
        settlement_loss_rate: "0.0000% (ZERO_LOSS)",
        bank_clearing_route: "BEFTN_NPSB_EFT_DIRECT",
        health_status: "HEALTHY_OPTIMAL"
      }
    },
    kafka: {
      title: '[ NODE INSPECTOR: Kafka Partitioned Event Fabric ]',
      cluster: 'CLUSTER: #DHAKA-KAFKA-CLUSTER',
      desc: 'Distributed messaging backbone streaming transactions across 32 partitioned topics, decoupling high-velocity disbursement from eco-gamification and AI inference.',
      throughput: '85,000 msg/s',
      latency: '0.4ms P99',
      replicas: '3x Sync Replicas',
      uptime: '99.999% SLA',
      tech: ['Apache Kafka', 'Schema Registry', 'Zookeeper / KRaft', 'Snappy Compression', 'WAL Logs'],
      payload: {
        node_id: "node-kafka-fabric",
        cluster: "DHAKA-KAFKA-CLUSTER",
        partition_count: 32,
        consumer_lag: "0.00ms (ZERO_LAG)",
        throughput_msg_per_sec: 85000,
        replication_factor: 3,
        retention_window_days: 7,
        health_status: "HEALTHY_OPTIMAL"
      }
    },
    forest: {
      title: '[ NODE INSPECTOR: bKash Forest Green Ledger Engine ]',
      cluster: 'CLUSTER: #DHAKA-ECO-GREEN',
      desc: 'Eco-sustainability microservice gamifying fintech transactions into 1.2M+ real-world planted trees with real-time carbon offset accounting and GIS spatial verification (Team Lead).',
      throughput: '12,400 events/s',
      latency: '8.4ms P99',
      replicas: '8 Clustered Pods',
      uptime: '99.995% SLA',
      tech: ['Go Microservice', 'PostGIS', 'Redis Geohash', 'Kafka Consumer', 'Docker / K8s'],
      payload: {
        node_id: "node-bkash-forest",
        cluster: "DHAKA-ECO-GREEN",
        trees_planted_total: 1248920,
        carbon_offset_tons: 30420.5,
        geo_zone_active: "BANGLADESH_GIS_DISTRICTS",
        gamification_reward_loop: "ACTIVE_STREAMING",
        lead_engineer: "Md. Sazzadul Islam (Sazib)",
        health_status: "HEALTHY_OPTIMAL"
      }
    },
    ai: {
      title: '[ NODE INSPECTOR: Alice Labs Revora AI Chatbot Builder ]',
      cluster: 'CLUSTER: #SINGAPORE-AI-NODE',
      desc: 'Conversational NLP transformer pipeline routing millions of monthly WhatsApp dialogues with automated multi-turn visual graph routing and <25ms intent matching.',
      throughput: '3,800 dialog/s',
      latency: '18.2ms P99',
      replicas: '12 GPU/CPU Pods',
      uptime: '99.99% SLA',
      tech: ['Python / PyTorch', 'Transformers NLP', 'WhatsApp Cloud API', 'FastAPI', 'Redis Cache'],
      payload: {
        node_id: "node-revora-ai-builder",
        cluster: "SINGAPORE-AI-NODE",
        dialogue_turn_latency_ms: 18.2,
        intent_match_accuracy: "99.4%",
        channels_supported: ["WhatsApp_Business", "Web_Widget", "Messenger"],
        active_conversations_monthly: 10200000,
        health_status: "HEALTHY_OPTIMAL"
      }
    }
  };

  let currentNodeKey = 'client';

  function inspectArchitectureNode(nodeKey) {
    if (!nodeSpecs[nodeKey]) return;
    currentNodeKey = nodeKey;
    const spec = nodeSpecs[nodeKey];

    // Highlight active card
    qa('.arch-node').forEach((n) => {
      if (n.getAttribute('data-node') === nodeKey) {
        n.classList.add('active-inspected');
      } else {
        n.classList.remove('active-inspected');
      }
    });

    const inspectorTitle = q('#inspectorTitle');
    const inspectorClusterTag = q('#inspectorClusterTag');
    const inspectorRoleDesc = q('#inspectorRoleDesc');
    const inspectorThroughput = q('#inspectorThroughput');
    const inspectorLatency = q('#inspectorLatency');
    const inspectorReplicas = q('#inspectorReplicas');
    const inspectorUptime = q('#inspectorUptime');
    const inspectorTechPills = q('#inspectorTechPills');
    const inspectorPayloadScreen = q('#inspectorPayloadScreen');

    if (inspectorTitle) inspectorTitle.textContent = spec.title;
    if (inspectorClusterTag) inspectorClusterTag.textContent = spec.cluster;
    if (inspectorRoleDesc) inspectorRoleDesc.textContent = spec.desc;
    if (inspectorThroughput) inspectorThroughput.textContent = spec.throughput;
    if (inspectorLatency) inspectorLatency.textContent = spec.latency;
    if (inspectorReplicas) inspectorReplicas.textContent = spec.replicas;
    if (inspectorUptime) inspectorUptime.textContent = spec.uptime;

    if (inspectorTechPills) {
      inspectorTechPills.innerHTML = spec.tech.map((t) => `<span class="tech-pill">${t}</span>`).join('');
    }

    if (inspectorPayloadScreen) {
      inspectorPayloadScreen.innerHTML = `<code>${JSON.stringify(spec.payload, null, 2)}</code>`;
      gsap.fromTo(inspectorPayloadScreen, { opacity: 0.4, y: 3 }, { opacity: 1, y: 0, duration: 0.25 });
    }
  }

  // Flow Tabs Filter
  qa('.arch-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      qa('.arch-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const flow = tab.getAttribute('data-flow');
      const nodes = qa('.arch-node');
      const paths = qa('.circuit-path');

      // Update Node Focus & Ripples
      nodes.forEach((n) => {
        n.classList.remove('node-pulse-active');
        if (flow === 'all') {
          n.style.opacity = '1';
          n.style.filter = 'none';
          n.classList.add('node-pulse-active');
        } else if (flow === 'disbursement' || flow === 'fintech') {
          if (n.id === 'node-client' || n.id === 'node-gateway' || n.id === 'node-engine' || n.id === 'node-kafka') {
            n.style.opacity = '1';
            n.style.filter = 'none';
            n.classList.add('node-pulse-active');
          } else {
            n.style.opacity = '0.2';
            n.style.filter = 'grayscale(100%)';
          }
        } else if (flow === 'forest') {
          if (n.id === 'node-client' || n.id === 'node-engine' || n.id === 'node-kafka' || n.id === 'node-forest') {
            n.style.opacity = '1';
            n.style.filter = 'none';
            n.classList.add('node-pulse-active');
          } else {
            n.style.opacity = '0.2';
            n.style.filter = 'grayscale(100%)';
          }
        } else if (flow === 'ai') {
          if (n.id === 'node-client' || n.id === 'node-gateway' || n.id === 'node-ai') {
            n.style.opacity = '1';
            n.style.filter = 'none';
            n.classList.add('node-pulse-active');
          } else {
            n.style.opacity = '0.2';
            n.style.filter = 'grayscale(100%)';
          }
        }
      });

      // Update SVG Path Glows
      paths.forEach((p) => {
        p.classList.remove('active');
        if (flow === 'all') {
          p.classList.add('active');
        } else if (flow === 'disbursement' && p.classList.contains('path-disburse')) {
          p.classList.add('active');
        } else if (flow === 'forest' && (p.classList.contains('path-forest') || p.id === 'path-c3')) {
          p.classList.add('active');
        } else if (flow === 'ai' && p.classList.contains('path-ai')) {
          p.classList.add('active');
        }
      });

      // Auto-inspect primary flow node
      if (flow === 'disbursement') inspectArchitectureNode('engine');
      else if (flow === 'forest') inspectArchitectureNode('forest');
      else if (flow === 'ai') inspectArchitectureNode('ai');
      else inspectArchitectureNode('client');
    });
  });

  // Click any node to inspect and trigger pulse wave
  qa('.arch-node').forEach((node) => {
    node.addEventListener('click', () => {
      gsap.fromTo(node, { scale: 0.96 }, { scale: 1.04, duration: 0.35, yoyo: true, repeat: 1, ease: 'back.out(2)' });
      node.classList.add('node-pulse-active');
      setTimeout(() => node.classList.remove('node-pulse-active'), 1600);

      const nodeId = node.getAttribute('data-node');
      if (nodeId) {
        inspectArchitectureNode(nodeId);
      }
    });
  });

  // Pulse Current Node Button
  const btnPulseCurrentNode = q('#btnPulseCurrentNode');
  if (btnPulseCurrentNode) {
    btnPulseCurrentNode.addEventListener('click', () => {
      const activeNodeEl = q(`#node-${currentNodeKey}`);
      if (activeNodeEl) {
        gsap.fromTo(activeNodeEl, { scale: 0.92 }, { scale: 1.06, duration: 0.4, yoyo: true, repeat: 1, ease: 'back.out(2.5)' });
        activeNodeEl.classList.add('node-pulse-active');
        setTimeout(() => activeNodeEl.classList.remove('node-pulse-active'), 1800);
      }

      // Pop corresponding live telemetry packet
      const spec = nodeSpecs[currentNodeKey];
      if (spec) {
        popTelemetryCard({
          title: spec.title.replace(/\[ NODE INSPECTOR: | \]/g, ''),
          badge: spec.cluster,
          badgeClass: currentNodeKey === 'forest' ? 'forest' : currentNodeKey === 'ai' ? 'ai' : 'disburse',
          desc: spec.desc,
          metricLbl: 'THROUGHPUT / LATENCY',
          metricVal: `${spec.throughput} · ${spec.latency}`,
          hash: `spec_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
        });
      }
    });
  }

  // ==========================================================================
  // 07. "POP CARD FROM ANYWHERE TO ANYWHERE" & PRODUCTION EVENT SIMULATOR
  // ==========================================================================
  const popStage = q('#popCardStage');
  const simTerminalScreen = q('#simTerminalScreen');
  const simPacketCount = q('#simPacketCount');
  const liveTpsCounter = q('#liveTpsCounter');
  const liveLatencyGauge = q('#liveLatencyGauge');
  const liveActiveCardsCount = q('#liveActiveCardsCount');
  const toggleSoundBtn = q('#toggleSoundBtn');
  const toggleStreamBtn = q('#toggleStreamBtn');
  const clearTerminalBtn = q('#clearTerminalBtn');

  let activeCardCount = 0;
  let packetCounter = 3;
  let soundEnabled = true;
  let autoStreamActive = true;
  let audioCtx = null;

  // Web Audio Synthesizer (Zero-dependency sci-fi / fintech audio feedback)
  function playSynthBlip(type = 'default') {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtx = new AudioContext();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      if (!audioCtx) return;

      const now = audioCtx.currentTime;
      if (type === 'disburse') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(580, now);
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'forest') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'ai') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1400, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.13);
      } else if (type === 'cascade') {
        [600, 900, 1300].forEach((freq, i) => {
          const subOsc = audioCtx.createOscillator();
          const subGain = audioCtx.createGain();
          subOsc.connect(subGain);
          subGain.connect(audioCtx.destination);
          const t = now + i * 0.07;
          subOsc.type = 'sine';
          subOsc.frequency.setValueAtTime(freq, t);
          subGain.gain.setValueAtTime(0.09, t);
          subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          subOsc.start(t);
          subOsc.stop(t + 0.13);
        });
      } else if (type === 'clear') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.13);
      }
    } catch (e) {
      // Audio autoplay policy / unsupported fallback
    }
  }

  function updateActiveCardsDisplay() {
    if (liveActiveCardsCount) {
      liveActiveCardsCount.textContent = `${activeCardCount} ACTIVE`;
      liveActiveCardsCount.style.color = activeCardCount > 0 ? '#ff1e42' : 'var(--muted)';
    }
  }

  function spikeMetrics(tpsBase = 5000, latencyBase = 28) {
    if (liveTpsCounter) {
      const spikeTps = Math.floor(tpsBase + (Math.random() - 0.3) * 600);
      liveTpsCounter.textContent = `${spikeTps.toLocaleString()} TPS`;
      liveTpsCounter.style.color = '#ff1e42';
      setTimeout(() => {
        if (liveTpsCounter) liveTpsCounter.style.color = '';
      }, 400);
    }
    if (liveLatencyGauge) {
      const jitterLat = (latencyBase + (Math.random() - 0.5) * 8).toFixed(1);
      liveLatencyGauge.textContent = `${jitterLat}ms`;
    }
  }

  function logToTerminal(category, tag, message) {
    if (!simTerminalScreen) return;

    packetCounter++;
    if (simPacketCount) {
      simPacketCount.textContent = `PACKETS EMITTED: ${packetCounter.toString().padStart(2, '0')}`;
    }

    const timeStr = new Date().toTimeString().split(' ')[0];
    const line = document.createElement('div');
    line.className = `term-line event-${category}`;
    line.innerHTML = `<span class="term-time">[${timeStr}]</span> <span class="term-sys">[${tag}]</span> ${message}`;

    simTerminalScreen.appendChild(line);

    // Keep max 25 lines
    while (simTerminalScreen.children.length > 25) {
      simTerminalScreen.removeChild(simTerminalScreen.firstChild);
    }

    simTerminalScreen.scrollTop = simTerminalScreen.scrollHeight;
  }

  // Background Telemetry Streamer (Keeps console dynamic & alive)
  const simulatedEvents = [
    { cat: 'stream', tag: 'FINTECH_TXN', msg: 'bKash Merchant Settlement #MS-77182 processed (৳62,400) · Kafka Partition #09' },
    { cat: 'stream', tag: 'GIS_SYNC', msg: 'bKash Forest user tree seed planted at Lat 23.8103, Lon 90.4125 (CO₂ -0.02kg)' },
    { cat: 'stream', tag: 'REVORA_NLP', msg: 'WhatsApp query session #WA-9042 intent parsed in 16ms (Confidence: 99.8%)' },
    { cat: 'stream', tag: 'G2P_EFT', msg: 'Government stipend batch #BD-2026-88 disbursed to 1,840 recipient digital wallets' },
    { cat: 'stream', tag: 'CLUSTER_HEARTBEAT', msg: 'Dhaka Core Cluster Node #02 OK · Latency: 0.72ms · Zero Dropped Packets' },
    { cat: 'stream', tag: 'SELF_SERVICE', msg: 'Merchant Instant Onboarding eKYC OCR verified in 1.4s · Token issued' }
  ];
  let streamIdx = 0;

  setInterval(() => {
    if (!autoStreamActive) return;
    const evt = simulatedEvents[streamIdx % simulatedEvents.length];
    streamIdx++;
    logToTerminal(evt.cat, evt.tag, evt.msg);
    spikeMetrics(4820, 28);
  }, 3400);

  // Pop Telemetry Card Engine
  function popTelemetryCard(options = {}) {
    if (!popStage) return;

    activeCardCount++;
    updateActiveCardsDisplay();

    const card = document.createElement('div');
    card.className = 'telemetry-pop-card glass-card';

    const title = options.title || 'Live Telemetry Packet';
    const badge = options.badge || 'EVENT DISPATCH';
    const badgeClass = options.badgeClass || 'disburse';
    const desc = options.desc || 'Real-time telemetry event processed across distributed cloud nodes.';
    const metricLbl = options.metricLbl || 'PROCESSING TIME';
    const metricVal = options.metricVal || `${(Math.random() * 30 + 12).toFixed(1)}ms`;
    const hash = options.hash || `pkt_${Math.random().toString(36).substring(2, 10)}`;

    card.innerHTML = `
      <div class="pop-card-header">
        <span class="pop-card-badge ${badgeClass}">${badge}</span>
        <button class="pop-card-close" aria-label="Dismiss card" title="Dismiss card">&times;</button>
      </div>
      <h4 class="pop-card-title">${title}</h4>
      <p class="pop-card-desc">${desc}</p>
      <div class="pop-card-metric-row">
        <span>${metricLbl}</span>
        <span>${metricVal}</span>
      </div>
      <div class="pop-card-hash">ID: ${hash} · ${new Date().toLocaleTimeString()} (Click to dismiss)</div>
    `;

    popStage.appendChild(card);

    // Dynamic flight trajectory vectors (pop from anywhere to anywhere)
    const origins = [
      { x: -380, y: Math.random() * (window.innerHeight * 0.7), rot: -28 },
      { x: window.innerWidth + 380, y: Math.random() * (window.innerHeight * 0.7), rot: 28 },
      { x: Math.random() * (window.innerWidth * 0.7), y: -250, rot: -15 },
      { x: Math.random() * (window.innerWidth * 0.7), y: window.innerHeight + 250, rot: 18 }
    ];

    const origin = origins[Math.floor(Math.random() * origins.length)];

    // Target landing coordinates (safe viewport area)
    const targetW = 340;
    const targetH = 220;
    const targetX = Math.max(24, Math.min(window.innerWidth - targetW - 24, Math.random() * (window.innerWidth - targetW - 48) + 24));
    const targetY = Math.max(90, Math.min(window.innerHeight - targetH - 30, Math.random() * (window.innerHeight - targetH - 120) + 90));
    const targetRot = (Math.random() - 0.5) * 8;

    // Flight Tween with Kinetic Spring Bounce
    gsap.fromTo(card, {
      x: origin.x,
      y: origin.y,
      rotation: origin.rot,
      scale: 0.25,
      opacity: 0
    }, {
      x: targetX,
      y: targetY,
      rotation: targetRot,
      scale: 1,
      opacity: 1,
      duration: 0.85,
      ease: 'back.out(2.2)',
      onComplete: () => {
        // Gentle floating oscillation while docked
        gsap.to(card, {
          y: targetY + (Math.random() > 0.5 ? 8 : -8),
          rotation: targetRot + (Math.random() > 0.5 ? 1.5 : -1.5),
          duration: 2 + Math.random() * 1.5,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut'
        });
      }
    });

    let dismissed = false;
    const dismissCard = () => {
      if (dismissed) return;
      dismissed = true;
      activeCardCount = Math.max(0, activeCardCount - 1);
      updateActiveCardsDisplay();

      const exitOrigins = [
        { x: -400, y: targetY + (Math.random() - 0.5) * 200, rot: -35 },
        { x: window.innerWidth + 400, y: targetY + (Math.random() - 0.5) * 200, rot: 35 },
        { x: targetX, y: -300, rot: 15 }
      ];
      const exit = exitOrigins[Math.floor(Math.random() * exitOrigins.length)];

      gsap.to(card, {
        x: exit.x,
        y: exit.y,
        rotation: exit.rot,
        scale: 0.4,
        opacity: 0,
        duration: 0.55,
        ease: 'power3.in',
        onComplete: () => {
          if (card.parentNode) card.parentNode.removeChild(card);
        }
      });
    };

    // Close button dismiss
    const closeBtn = card.querySelector('.pop-card-close');
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissCard(); });

    // Click anywhere on card to dismiss
    card.addEventListener('click', dismissCard);

    // Auto-dismiss after 6.8 seconds
    setTimeout(() => {
      if (card.parentNode) dismissCard();
    }, 6800);
  }

  // Unified Simulation Trigger Router
  function triggerSimulation(actionType) {
    playSynthBlip(actionType);
    spikeMetrics(actionType === 'disburse' ? 5200 : actionType === 'cascade' ? 5400 : 4900, 24);

    const triggerEl = q(`#btnPop${actionType.charAt(0).toUpperCase() + actionType.slice(1)}`);
    if (triggerEl) {
      triggerEl.classList.add('is-firing');
      setTimeout(() => triggerEl.classList.remove('is-firing'), 400);
    }

    if (actionType === 'disburse') {
      logToTerminal('disburse', 'IDS_BATCH_EMITTED', '⚡ 5,000 TPS instant distribution batch dispatched across 50,000 digital wallets (34ms P99)');
      popTelemetryCard({
        title: '⚡ IDS 5,000 TPS Batch Settlement',
        badge: 'bKash IDS / G2P EFT',
        badgeClass: 'disburse',
        desc: 'Instant fund distribution batch executed across 50,000 recipient wallets with zero-loss consistency.',
        metricLbl: 'LATENCY / TPS',
        metricVal: '34ms · 5,000 TPS',
        hash: `ids_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      });
    } else if (actionType === 'forest') {
      logToTerminal('forest', 'FOREST_TREES_CREDITED', '🌲 +500 Verified Trees credited to eco-ledger. Geo-zone #DHAKA-48 (+12.4 Tons CO₂ offset computed)');
      popTelemetryCard({
        title: '🌲 bKash Forest +500 Verified Trees',
        badge: 'bKash Forest (Team Lead)',
        badgeClass: 'forest',
        desc: 'Eco-gamification reward loop credited. Verified GIS geo-coordinates mapped to plantation zone #DHAKA-48.',
        metricLbl: 'CO₂ OFFSET ADDED',
        metricVal: '+12.4 Tons CO₂',
        hash: `forest_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      });
    } else if (actionType === 'ai') {
      logToTerminal('ai', 'REVORA_NLP_INFERRED', '🤖 Natural Language intent parsed in 18ms. Multi-turn WhatsApp dialogue tree routed (99.4% match)');
      popTelemetryCard({
        title: '🤖 Revora AI WhatsApp Multi-Turn Dialogue',
        badge: 'Alice Labs (Revora AI)',
        badgeClass: 'ai',
        desc: 'Natural Language intent classified. Automated product support dialogue routed in <25ms.',
        metricLbl: 'CONFIDENCE SCORE',
        metricVal: '99.4% NLP Match',
        hash: `revora_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      });
    } else if (actionType === 'cascade') {
      logToTerminal('cascade', 'TRI_VECTOR_CASCADE', '💥 BROADCASTING FULL ECOSYSTEM WAVE: IDS settlement + Forest GIS + Revora NLP simultaneously');
      setTimeout(() => {
        popTelemetryCard({
          title: '💰 Payroll & G2P EFT Grant Distributed',
          badge: 'NATIONAL FINTECH',
          badgeClass: 'disburse',
          desc: 'Emergency G2P government aid package disbursed with automated bank ledger sync.',
          metricLbl: 'SETTLED SUM',
          metricVal: '100% Idempotent',
          hash: `g2p_${Math.random().toString(36).substring(2, 8)}`
        });
      }, 0);

      setTimeout(() => {
        popTelemetryCard({
          title: '🌿 1.2M+ Tree Milestone Reached',
          badge: 'ECO SUSTAINABILITY',
          badgeClass: 'forest',
          desc: 'bKash Forest user ecosystem crossed 1.2 Million real-world trees planted.',
          metricLbl: 'VERIFIED REGION',
          metricVal: 'Bangladesh GIS',
          hash: `eco_${Math.random().toString(36).substring(2, 8)}`
        });
      }, 200);

      setTimeout(() => {
        popTelemetryCard({
          title: '🤖 10M+ Conversational AI Workflows',
          badge: 'REVORA CHATBOT',
          badgeClass: 'ai',
          desc: 'Alice Labs visual dialogue trees actively routing high-volume WhatsApp merchant queries.',
          metricLbl: 'ACTIVE CHANNELS',
          metricVal: 'WhatsApp + Web',
          hash: `ai_${Math.random().toString(36).substring(2, 8)}`
        });
      }, 400);
    }
  }

  // Interactive Live Simulation Buttons & Cards
  const btnPopDisburse = q('#btnPopDisburse');
  const btnPopForest = q('#btnPopForest');
  const btnPopAI = q('#btnPopAI');
  const btnPopCascade = q('#btnPopCascade');

  if (btnPopDisburse) btnPopDisburse.addEventListener('click', () => triggerSimulation('disburse'));
  if (btnPopForest) btnPopForest.addEventListener('click', () => triggerSimulation('forest'));
  if (btnPopAI) btnPopAI.addEventListener('click', () => triggerSimulation('ai'));
  if (btnPopCascade) btnPopCascade.addEventListener('click', () => triggerSimulation('cascade'));

  // Quick Action Buttons in Banner
  qa('[data-sim-trigger]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-sim-trigger');
      if (type) triggerSimulation(type);
    });
  });

  // Terminal Controls
  if (toggleSoundBtn) {
    toggleSoundBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      toggleSoundBtn.textContent = soundEnabled ? '🔊 SFX: ON' : '🔇 SFX: OFF';
      toggleSoundBtn.classList.toggle('off', !soundEnabled);
      if (soundEnabled) playSynthBlip('disburse');
    });
  }

  if (toggleStreamBtn) {
    toggleStreamBtn.addEventListener('click', () => {
      autoStreamActive = !autoStreamActive;
      toggleStreamBtn.textContent = autoStreamActive ? '⚡ AUTO: ON' : '⏸️ AUTO: PAUSED';
      toggleStreamBtn.classList.toggle('off', !autoStreamActive);
    });
  }

  if (clearTerminalBtn) {
    clearTerminalBtn.addEventListener('click', () => {
      playSynthBlip('clear');
      if (simTerminalScreen) {
        simTerminalScreen.innerHTML = '';
        logToTerminal('stream', 'CONSOLE_RESET', 'Console buffer cleared. Telemetry listeners active on port 443.');
      }
    });
  }

  // Keyboard Shortcuts (1, 2, 3, 4, C)
  window.addEventListener('keydown', (e) => {
    // Avoid triggering when user is focused in an input or textarea
    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea') return;

    if (e.key === '1') {
      triggerSimulation('disburse');
    } else if (e.key === '2') {
      triggerSimulation('forest');
    } else if (e.key === '3') {
      triggerSimulation('ai');
    } else if (e.key === '4') {
      triggerSimulation('cascade');
    } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
      if (clearTerminalBtn) clearTerminalBtn.click();
    }
  });

  // ==========================================================================
  // 08. SELECTIVE 3D MAGNETIC CARD TILT & SPECULAR SHEEN (KEY SHOWCASE CARDS)
  // ==========================================================================
  const selectiveTiltCards = qa('.project-showcase, .arch-node, #heroScopeCard, .telemetry-pop-card, .tilt-highlight, .impact-stat-box, .sim-trigger-card');

  selectiveTiltCards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Real-time Specular Sheen Lighting coordinates
      const sheenX = `${Math.round((x / rect.width) * 100)}%`;
      const sheenY = `${Math.round((y / rect.height) * 100)}%`;
      card.style.setProperty('--sheen-x', sheenX);
      card.style.setProperty('--sheen-y', sheenY);

      // Controlled 3D perspective rotation angles
      const rotateX = ((y - centerY) / centerY) * -9.5;
      const rotateY = ((x - centerX) / centerX) * 9.5;

      gsap.to(card, {
        rotateX,
        rotateY,
        transformPerspective: 1000,
        scale: 1.025,
        duration: 0.35,
        ease: 'power2.out',
        overwrite: 'auto'
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        scale: 1,
        duration: 0.6,
        ease: 'power2.out',
        overwrite: 'auto'
      });
    });
  });

  // Magnetic Button Cursor Pull Micro-Interactions
  qa('.btn-primary, .btn-glass, .sim-quick-btn, .term-ctrl-btn, .term-clear-btn').forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      gsap.to(btn, {
        x: x * 0.26,
        y: y * 0.26,
        scale: 1.04,
        duration: 0.3,
        ease: 'power2.out'
      });
    });

    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, {
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.55,
        ease: 'elastic.out(1.2, 0.4)'
      });
    });
  });

  // ==========================================================================
  // 09. SKILLS ARSENAL CATEGORY FILTER
  // ==========================================================================
  qa('.filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      qa('.filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');

      const filter = pill.getAttribute('data-filter');
      qa('.skill-card').forEach((card) => {
        const cat = card.getAttribute('data-category');
        if (filter === 'all' || cat === filter) {
          gsap.to(card, { scale: 1, opacity: 1, duration: 0.3, display: 'flex', ease: 'back.out(1.5)' });
        } else {
          gsap.to(card, { scale: 0.88, opacity: 0, duration: 0.2, display: 'none' });
        }
      });
    });
  });

  // ==========================================================================
  // 10. INTERACTIVE MODAL DIALOGS
  // ==========================================================================
  qa('.open-modal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const modal = q(`#${targetId}`);
      if (modal) {
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  qa('.modal-close, .modal-backdrop').forEach((closer) => {
    closer.addEventListener('click', () => {
      qa('.modal').forEach((m) => {
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
      });
      document.body.style.overflow = '';
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      qa('.modal').forEach((m) => {
        m.classList.remove('active');
        m.setAttribute('aria-hidden', 'true');
      });
      document.body.style.overflow = '';
    }
  });

  // ==========================================================================
  // 11. EMAIL COPY TO CLIPBOARD
  // ==========================================================================
  const copyEmailBtn = q('#copyEmailBtn');
  const copyBtnText = q('#copyBtnText');
  if (copyEmailBtn) {
    copyEmailBtn.addEventListener('click', () => {
      const email = copyEmailBtn.getAttribute('data-email') || 'sazib66@gmail.com';
      navigator.clipboard.writeText(email).then(() => {
        const original = copyBtnText.textContent;
        copyBtnText.textContent = '[ COPIED: sazib66@gmail.com ✓ ]';
        copyEmailBtn.style.background = '#ff1e42';
        copyEmailBtn.style.color = '#fff';
        setTimeout(() => {
          copyBtnText.textContent = original;
          copyEmailBtn.style.background = '';
          copyEmailBtn.style.color = '';
        }, 2400);
      });
    });
  }

  // ==========================================================================
  // 12. NUDOT TEXT SCRAMBLER / DECODER MATRIX HOVER EFFECT
  // ==========================================================================
  class TextScrambler {
    constructor(el) {
      this.el = el;
      this.chars = '!<>-_\\/[]{}—=+*^?#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      this.originalText = el.textContent.trim();
      this.frame = 0;
      this.queue = [];
      this.frameRequest = null;
      this.isScrambling = false;
    }

    setText(newText) {
      const oldText = this.el.textContent;
      const length = Math.max(oldText.length, newText.length);
      this.queue = [];
      for (let i = 0; i < length; i++) {
        const from = oldText[i] || '';
        const to = newText[i] || '';
        const start = Math.floor(Math.random() * 8);
        const end = start + Math.floor(Math.random() * 12) + 10;
        this.queue.push({ from, to, start, end, char: '' });
      }
      cancelAnimationFrame(this.frameRequest);
      this.frame = 0;
      this.isScrambling = true;
      this.update();
    }

    update() {
      let output = '';
      let complete = 0;
      for (let i = 0, n = this.queue.length; i < n; i++) {
        let { from, to, start, end, char } = this.queue[i];
        if (this.frame >= end) {
          complete++;
          output += to;
        } else if (this.frame >= start) {
          if (!char || Math.random() < 0.28) {
            char = this.randomChar();
            this.queue[i].char = char;
          }
          output += `<span style="color:var(--crimson-bright);opacity:0.95">${char}</span>`;
        } else {
          output += from;
        }
      }
      this.el.innerHTML = output;
      if (complete === this.queue.length) {
        this.el.textContent = this.originalText;
        this.isScrambling = false;
      } else {
        this.frameRequest = requestAnimationFrame(() => {
          this.frame++;
          this.update();
        });
      }
    }

    randomChar() {
      return this.chars[Math.floor(Math.random() * this.chars.length)];
    }

    scramble() {
      if (this.isScrambling) return;
      this.originalText = this.el.getAttribute('data-original') || this.el.textContent.trim();
      this.el.setAttribute('data-original', this.originalText);
      this.setText(this.originalText);
    }
  }

  // Attach TextScrambler to all designated elements
  const scrambleElements = qa('[data-scramble], .nav-link, .section-badge, .project-name, .scope-company, .brand-name');
  scrambleElements.forEach((el) => {
    const scrambler = new TextScrambler(el);
    el.addEventListener('mouseenter', () => scrambler.scramble());
  });

  // ==========================================================================
  // 13. NUDOT MAGNETIC CURSOR & DYNAMIC MORPHING CAPSULE
  // ==========================================================================
  class NuDotCursorManager {
    constructor() {
      this.dot = q('#cursorDot');
      this.ring = q('#cursorRing');
      this.label = q('#cursorLabel');
      this.glow = q('#cursorGlow');

      if (!this.dot || !this.ring) return;

      this.mouseX = window.innerWidth / 2;
      this.mouseY = window.innerHeight / 2;
      this.ringX = this.mouseX;
      this.ringY = this.mouseY;
      this.glowX = this.mouseX;
      this.glowY = this.mouseY;

      this.isActive = false;

      this.init();
    }

    init() {
      if (!window.matchMedia('(pointer: fine)').matches) {
        if (this.dot) this.dot.style.display = 'none';
        if (this.ring) this.ring.style.display = 'none';
        return;
      }

      window.addEventListener('mousemove', (e) => {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;

        if (this.dot) {
          this.dot.style.left = `${this.mouseX}px`;
          this.dot.style.top = `${this.mouseY}px`;
        }
      });

      const loop = () => {
        const ease = this.isActive ? 0.22 : 0.15;
        this.ringX += (this.mouseX - this.ringX) * ease;
        this.ringY += (this.mouseY - this.ringY) * ease;

        if (this.ring) {
          this.ring.style.left = `${this.ringX}px`;
          this.ring.style.top = `${this.ringY}px`;
        }

        this.glowX += (this.mouseX - this.glowX) * 0.08;
        this.glowY += (this.mouseY - this.glowY) * 0.08;
        if (this.glow) {
          this.glow.style.transform = `translate(${this.glowX}px, ${this.glowY}px)`;
        }

        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      // Attach hover states to all interactive elements
      const hoverTargets = qa('[data-cursor], a, button, .arch-node, .project-showcase, .timeline-card, .skill-card, .sim-btn');
      hoverTargets.forEach((target) => {
        target.addEventListener('mouseenter', () => {
          const customLabel = target.getAttribute('data-cursor') || (target.tagName === 'A' || target.tagName === 'BUTTON' ? 'OPEN' : 'EXPLORE');
          this.setHoverState(true, customLabel);
        });

        target.addEventListener('mouseleave', () => {
          this.setHoverState(false);
        });
      });
    }

    setHoverState(active, labelText = 'EXPLORE') {
      this.isActive = active;
      if (active) {
        if (this.label) this.label.textContent = labelText;
        if (this.ring) this.ring.classList.add('active-hover');
        if (this.dot) this.dot.style.opacity = '0';
      } else {
        if (this.ring) this.ring.classList.remove('active-hover');
        if (this.dot) this.dot.style.opacity = '1';
      }
    }
  }

  new NuDotCursorManager();

  // ==========================================================================
  // 14. LIVE DHAKA TELEMETRY CLOCK (NUDOT PATTERN)
  // ==========================================================================
  function initLiveClock() {
    const clockEl = q('#navClock');
    if (!clockEl) return;

    const update = () => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const dhakaTime = new Date(utc + (3600000 * 6));
      const h = dhakaTime.getHours().toString().padStart(2, '0');
      const m = dhakaTime.getMinutes().toString().padStart(2, '0');
      const s = dhakaTime.getSeconds().toString().padStart(2, '0');
      clockEl.textContent = `DHAKA [ ${h}:${m}:${s} UTC+6 ]`;
    };

    update();
    setInterval(update, 1000);
  }

  initLiveClock();
});

