/* ============================================================
   IMMUTABLE QUALITY CONTROL — INTERACTIVITY (cleaned per Opus 4.8 review)
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {
    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    const allNavLinks = document.querySelectorAll('.nav__link');

    function updateNavState() {
        if (window.scrollY > 50) navbar.classList.add('nav--scrolled');
        else navbar.classList.remove('nav--scrolled');
    }
    window.addEventListener('scroll', updateNavState, { passive: true });
    updateNavState();

    navToggle.addEventListener('click', function () {
        const isOpen = navLinks.classList.toggle('nav__links--open');
        navToggle.classList.toggle('nav__toggle--active');
        navToggle.setAttribute('aria-expanded', isOpen);
    });

    allNavLinks.forEach(link => {
        link.addEventListener('click', function () {
            navLinks.classList.remove('nav__links--open');
            navToggle.classList.remove('nav__toggle--active');
            navToggle.setAttribute('aria-expanded', 'false');
        });
    });

    document.addEventListener('click', function (e) {
        if (!navLinks.contains(e.target) && !navToggle.contains(e.target)) {
            navLinks.classList.remove('nav__links--open');
            navToggle.classList.remove('nav__toggle--active');
            navToggle.setAttribute('aria-expanded', 'false');
        }
    });

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                e.preventDefault();
                const navHeight = navbar.offsetHeight;
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
            }
        });
    });

    const animatedElements = document.querySelectorAll('.card, .pipeline__step, .stack__item, .status-strip__item');
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, { root: null, rootMargin: '0px 0px -60px 0px', threshold: 0.1 });

        animatedElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(24px)';
            el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(el);
        });
    }
});