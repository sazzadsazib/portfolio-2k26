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

    // In-memory Blob preloader to eliminate network socket latency and Range stalls
    const initialSrc = this.video.getAttribute('src') || '/portfolio-placeholder.mp4';
    if (initialSrc && !initialSrc.startsWith('blob:')) {
      fetch(initialSrc)
        .then((res) => {
          if (res.ok) return res.blob();
          throw new Error('Blob fetch failed');
        })
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          const prevTime = this.video.currentTime || 0.001;
          this.video.src = blobUrl;
          this.video.currentTime = Math.max(0.001, prevTime);
        })
        .catch(() => {
          // Fallback to existing src
        });
    }

    const start = () => {
      // Prime decoder pipeline smoothly
      this.video.currentTime = 0.001;
      const playPromise = this.video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          this.video.pause();
          this.video.currentTime = 0.001;
        }).catch(() => {});
      }

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
    const clampedTime = Math.max(0.001, Math.min(maxDur, time));

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
  // 04. SCROLLTRIGGER & VIDEO PINNING SETUP
  // ==========================================================================
  function initScrollAnimations() {
    // Pinned Hero Section with Buttery Smooth Scroll Scrub
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

    // Timeline Line Fill Animation (Career Arc)
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

    // Timeline Cards 3D Pop-in Reveal (Alternating Left & Right Trajectories)
    qa('.timeline-card').forEach((card, idx) => {
      const isEven = idx % 2 === 0;
      gsap.from(card, {
        x: isEven ? -60 : 60,
        y: 40,
        rotateY: isEven ? 12 : -12,
        scale: 0.9,
        opacity: 0,
        duration: 0.85,
        delay: idx * 0.06,
        ease: 'back.out(1.5)',
        scrollTrigger: {
          trigger: card,
          start: 'top 85%'
        }
      });
    });

    // Projects Grid 3D Diagonal Pop Reveal
    qa('.project-showcase').forEach((item, idx) => {
      const isEven = idx % 2 === 0;
      gsap.from(item, {
        x: isEven ? -40 : 40,
        y: 50,
        rotate: isEven ? -2 : 2,
        scale: 0.92,
        opacity: 0,
        duration: 0.75,
        delay: idx * 0.1,
        ease: 'back.out(1.4)',
        scrollTrigger: {
          trigger: item,
          start: 'top 85%'
        }
      });
    });

    // Architecture Simulator Nodes Pop
    qa('.arch-node').forEach((node, i) => {
      gsap.from(node, {
        scale: 0.85,
        y: 30,
        opacity: 0,
        duration: 0.6,
        delay: i * 0.08,
        ease: 'back.out(1.7)',
        scrollTrigger: {
          trigger: '.architecture-diagram',
          start: 'top 75%'
        }
      });
    });

    // Digital Number Counter-Up Animation
    ScrollTrigger.create({
      trigger: '.impact-grid',
      start: 'top 80%',
      once: true,
      onEnter: () => {
        qa('.counter-num').forEach((counter) => {
          const target = parseFloat(counter.getAttribute('data-target') || '0');
          const decimals = parseInt(counter.getAttribute('data-decimals') || '0');
          const obj = { val: 0 };
          gsap.to(obj, {
            val: target,
            duration: 2.2,
            ease: 'power2.out',
            onUpdate: () => {
              counter.textContent = decimals > 0 ? obj.val.toFixed(decimals) : Math.round(obj.val).toLocaleString();
            }
          });
        });
      }
    });

    // Impact Stats Box Pop Animation
    qa('.impact-stat-box').forEach((box, i) => {
      gsap.from(box, {
        y: 35,
        scale: 0.92,
        opacity: 0,
        duration: 0.7,
        delay: i * 0.1,
        ease: 'back.out(1.6)',
        scrollTrigger: {
          trigger: '.impact-section',
          start: 'top 80%'
        }
      });
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
  // 06. ARCHITECTURE FLOW SIMULATOR & SVG CIRCUIT ENERGY
  // ==========================================================================
  // Infinite circuit pulse dash offset loop
  gsap.to('.circuit-path', {
    strokeDashoffset: -40,
    duration: 1.8,
    repeat: -1,
    ease: 'none'
  });

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
    });
  });

  // Click any node to trigger pulse wave and pop a live node telemetry card
  qa('.arch-node').forEach((node) => {
    node.addEventListener('click', () => {
      gsap.fromTo(node, { scale: 0.95 }, { scale: 1.05, duration: 0.4, yoyo: true, repeat: 1, ease: 'back.out(2)' });
      node.classList.add('node-pulse-active');
      setTimeout(() => node.classList.remove('node-pulse-active'), 1800);

      const nodeId = node.getAttribute('data-node');
      if (nodeId === 'client') {
        popTelemetryCard({
          title: '50M+ User Mobile & USSD Gateway',
          badge: 'CLIENT TRAFFIC',
          badgeClass: 'disburse',
          desc: 'High-concurrency ingress from bKash App, USSD gateways, and Merchant APIs with mTLS verification.',
          metricLbl: 'INGRESS RATE',
          metricVal: '48,200 req/sec',
          hash: `tx_${Math.random().toString(36).substring(2, 9)}_client`
        });
      } else if (nodeId === 'gateway') {
        popTelemetryCard({
          title: 'API Gateway & Self-Service',
          badge: 'SECURITY & ROUTING',
          badgeClass: 'disburse',
          desc: 'Automated HMAC signature checks, merchant self-service authentication, and rate limiting.',
          metricLbl: 'AUTH LATENCY',
          metricVal: '1.2ms (P99)',
          hash: `gw_auth_${Math.random().toString(36).substring(2, 9)}`
        });
      } else if (nodeId === 'engine') {
        popTelemetryCard({
          title: 'IDS & G2P EFT Batch Engine',
          badge: 'FINTECH CORE',
          badgeClass: 'disburse',
          desc: 'Zero-loss idempotent transaction execution with distributed Saga state machine.',
          metricLbl: 'THROUGHPUT',
          metricVal: '5,000 TPS Batch',
          hash: `ids_batch_${Math.random().toString(36).substring(2, 9)}`
        });
      } else if (nodeId === 'forest') {
        popTelemetryCard({
          title: 'bKash Forest Green Ledger',
          badge: 'GREEN FINTECH',
          badgeClass: 'forest',
          desc: 'Real-time carbon offset accounting and GIS verified tree planting reward loops.',
          metricLbl: 'TOTAL IMPACT',
          metricVal: '1.2M+ Planted',
          hash: `eco_gis_${Math.random().toString(36).substring(2, 9)}`
        });
      } else if (nodeId === 'ai') {
        popTelemetryCard({
          title: 'Alice Labs Revora AI Builder',
          badge: 'REVORA AI',
          badgeClass: 'ai',
          desc: 'Natural Language Processing intent classifier with multi-turn WhatsApp conversation graphs.',
          metricLbl: 'ACCURACY',
          metricVal: '98.7% Intent Match',
          hash: `revora_ai_${Math.random().toString(36).substring(2, 9)}`
        });
      } else if (nodeId === 'kafka') {
        popTelemetryCard({
          title: 'Kafka Partitioned Event Fabric',
          badge: 'EVENT STREAM',
          badgeClass: 'disburse',
          desc: 'Distributed messaging backbone decoupling financial transactions from reward calculations.',
          metricLbl: 'PARTITION LAG',
          metricVal: '0.00ms Zero Lag',
          hash: `kafka_topic_${Math.random().toString(36).substring(2, 9)}`
        });
      }
    });
  });

  // ==========================================================================
  // 07. "POP CARD FROM ANYWHERE TO ANYWHERE" INTERACTIVE ENGINE
  // ==========================================================================
  const popStage = q('#popCardStage');

  function popTelemetryCard(options = {}) {
    if (!popStage) return;

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
        <button class="pop-card-close" aria-label="Dismiss card">&times;</button>
      </div>
      <h4 class="pop-card-title">${title}</h4>
      <p class="pop-card-desc">${desc}</p>
      <div class="pop-card-metric-row">
        <span>${metricLbl}</span>
        <span>${metricVal}</span>
      </div>
      <div class="pop-card-hash">ID: ${hash} · ${new Date().toLocaleTimeString()}</div>
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

    const dismissCard = () => {
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

  // Interactive Live Simulation Buttons
  const btnPopDisburse = q('#btnPopDisburse');
  const btnPopForest = q('#btnPopForest');
  const btnPopAI = q('#btnPopAI');
  const btnPopCascade = q('#btnPopCascade');

  if (btnPopDisburse) {
    btnPopDisburse.addEventListener('click', () => {
      popTelemetryCard({
        title: '⚡ IDS 5,000 TPS Batch Settlement',
        badge: 'bKash IDS / G2P EFT',
        badgeClass: 'disburse',
        desc: 'Instant fund distribution batch executed across 50,000 recipient wallets with zero-loss consistency.',
        metricLbl: 'LATENCY / TPS',
        metricVal: '34ms · 5,000 TPS',
        hash: `ids_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      });
    });
  }

  if (btnPopForest) {
    btnPopForest.addEventListener('click', () => {
      popTelemetryCard({
        title: '🌲 bKash Forest +500 Verified Trees',
        badge: 'bKash Forest (Team Lead)',
        badgeClass: 'forest',
        desc: 'Eco-gamification reward loop credited. Verified GIS geo-coordinates mapped to plantation zone #DHAKA-48.',
        metricLbl: 'CO₂ OFFSET ADDED',
        metricVal: '+12.4 Tons CO₂',
        hash: `forest_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      });
    });
  }

  if (btnPopAI) {
    btnPopAI.addEventListener('click', () => {
      popTelemetryCard({
        title: '🤖 Revora AI WhatsApp Multi-Turn Dialogue',
        badge: 'Alice Labs (Revora AI)',
        badgeClass: 'ai',
        desc: 'Natural Language intent classified. Automated product support dialogue routed in <25ms.',
        metricLbl: 'CONFIDENCE SCORE',
        metricVal: '99.4% NLP Match',
        hash: `revora_${Math.random().toString(36).substring(2, 9).toUpperCase()}`
      });
    });
  }

  if (btnPopCascade) {
    btnPopCascade.addEventListener('click', () => {
      // Launch 3 cards from alternating corners simultaneously
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
      }, 220);

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
      }, 440);
    });
  }

  // ==========================================================================
  // 08. 3D MAGNETIC CARD TILT PHYSICS & SPECULAR CRIMSON GLARE
  // ==========================================================================
  const interactiveCards = qa('.glass-card, .timeline-card-inner, .project-showcase, .skill-card, .impact-stat-box, .contact-action-box');

  interactiveCards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Calculate subtle 3D tilt angles
      const rotateX = ((y - centerY) / centerY) * -8;
      const rotateY = ((x - centerX) / centerX) * 8;

      gsap.to(card, {
        rotateX,
        rotateY,
        transformPerspective: 1000,
        scale: 1.02,
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
        duration: 0.55,
        ease: 'power2.out',
        overwrite: 'auto'
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

