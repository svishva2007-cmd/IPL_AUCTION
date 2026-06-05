// ===============================
// IPL AUCTION ARENA - APP.JS
// ===============================

// ── Navbar ───────────────────────────────────────────────
const menuBtn  = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav-links');
const navbar   = document.querySelector('.navbar');

menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    navLinks.classList.toggle('show-menu');
    const expanded = navLinks.classList.contains('show-menu');
    menuBtn.setAttribute('aria-expanded', expanded);
});

// Close menu on outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.navbar')) {
        navLinks?.classList.remove('show-menu');
        menuBtn?.setAttribute('aria-expanded', 'false');
    }
});

// Close menu when a link is clicked
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks?.classList.remove('show-menu');
    });
});

// Navbar shadow on scroll
let ticking = false;
window.addEventListener('scroll', () => {
    if (!ticking) {
        requestAnimationFrame(() => {
            if (navbar) {
                navbar.style.boxShadow = window.scrollY > 50
                    ? '0 4px 20px rgba(0,200,255,0.25)'
                    : 'none';
            }
            ticking = false;
        });
        ticking = true;
    }
}, { passive: true });

// ── Scroll Reveal ─────────────────────────────────────────
const revealEls = document.querySelectorAll('.stat-card, .feature-card, .team-box');

const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
            setTimeout(() => entry.target.classList.add('show'), i * 60);
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

revealEls.forEach(el => observer.observe(el));

// ── Counter Animation ─────────────────────────────────────
const counterEls = document.querySelectorAll('.stat-card h3');

const animateCounter = (el) => {
    const text = el.textContent.trim();
    if (/[₹+A-Za-z]/.test(text)) return;

    const target = parseInt(text, 10);
    if (isNaN(target)) return;

    const duration = 1200;
    const start    = performance.now();

    const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.ceil(eased * target);
        if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
};

const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

counterEls.forEach(el => counterObserver.observe(el));