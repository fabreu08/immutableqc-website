/* ============================================================
   IMMUTABLE QUALITY CONTROL — INTERACTIVITY
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    // ---------- DOM References ----------
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    const allNavLinks = document.querySelectorAll('.nav__link');
    const phaseHeaders = document.querySelectorAll('.phase__header');
    const heroScrollIndicator = document.querySelector('.hero__scroll-indicator');

    // ---------- Sticky Nav: Shadow & Background on Scroll ----------
    function updateNavState() {
        if (window.scrollY > 50) {
            navbar.classList.add('nav--scrolled');
        } else {
            navbar.classList.remove('nav--scrolled');
        }

        // Fade out scroll indicator as user scrolls
        if (heroScrollIndicator) {
            const heroHeight = document.querySelector('.hero').offsetHeight;
            const opacity = Math.max(0, 1 - (window.scrollY / (heroHeight * 0.4)));
            heroScrollIndicator.style.opacity = opacity;
        }
    }

    window.addEventListener('scroll', updateNavState, { passive: true });
    updateNavState(); // initial call

    // ---------- Mobile Menu Toggle ----------
    navToggle.addEventListener('click', function () {
        const isOpen = navLinks.classList.toggle('nav__links--open');
        navToggle.classList.toggle('nav__toggle--active');
        navToggle.setAttribute('aria-expanded', isOpen);
    });

    // Close mobile menu when a link is clicked
    allNavLinks.forEach(link => {
        link.addEventListener('click', function () {
            navLinks.classList.remove('nav__links--open');
            navToggle.classList.remove('nav__toggle--active');
            navToggle.setAttribute('aria-expanded', 'false');
        });
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', function (e) {
        if (!navLinks.contains(e.target) && !navToggle.contains(e.target)) {
            navLinks.classList.remove('nav__links--open');
            navToggle.classList.remove('nav__toggle--active');
            navToggle.setAttribute('aria-expanded', 'false');
        }
    });

    // ---------- Roadmap Phase Toggle (Accordion) ----------
    phaseHeaders.forEach(header => {
        header.addEventListener('click', function () {
            const phase = this.parentElement;
            const body = phase.querySelector('.phase__body');
            const toggle = phase.querySelector('.phase__toggle');
            const isOpen = body.classList.contains('phase__body--open');

            // Close all other phases
            document.querySelectorAll('.phase__body--open').forEach(openBody => {
                if (openBody !== body) {
                    openBody.classList.remove('phase__body--open');
                    const siblingToggle = openBody.closest('.phase').querySelector('.phase__toggle');
                    if (siblingToggle) {
                        siblingToggle.setAttribute('aria-expanded', 'false');
                    }
                }
            });

            // Toggle current phase
            if (isOpen) {
                body.classList.remove('phase__body--open');
                toggle.setAttribute('aria-expanded', 'false');
            } else {
                body.classList.add('phase__body--open');
                toggle.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Open Phase 1 by default (it's the current phase)
    const phaseOneBody = document.querySelector('.phase--active .phase__body');
    const phaseOneToggle = document.querySelector('.phase--active .phase__toggle');
    if (phaseOneBody && phaseOneToggle) {
        phaseOneBody.classList.add('phase__body--open');
        phaseOneToggle.setAttribute('aria-expanded', 'true');
    }

    // ---------- Smooth Scroll Offset for Fixed Nav ----------
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                const navHeight = navbar.offsetHeight;
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // ---------- Intersection Observer for Scroll Animations ----------
    const animatedElements = document.querySelectorAll(
        '.advantage__card, .about__card, .pipeline__step, .phase'
    );

    if ('IntersectionObserver' in window) {
        const observerOptions = {
            root: null,
            rootMargin: '0px 0px -60px 0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        animatedElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(24px)';
            el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(el);
        });
    } else {
        // Fallback: show all elements immediately
        animatedElements.forEach(el => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        });
    }

});