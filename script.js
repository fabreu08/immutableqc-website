document.addEventListener("DOMContentLoaded", function () {
    const navbar = document.getElementById("navbar");
    const navToggle = document.getElementById("navToggle");
    const navLinks = document.getElementById("navLinks");

    function updateNavState() {
        navbar.classList.toggle("nav--scrolled", window.scrollY > 50);
    }
    window.addEventListener("scroll", updateNavState, { passive: true });
    updateNavState();

    navToggle.addEventListener("click", function () {
        const isOpen = navLinks.classList.toggle("is-open");
        navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    navLinks.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            navLinks.classList.remove("is-open");
            navToggle.setAttribute("aria-expanded", "false");
        });
    });

    document.addEventListener("click", function (e) {
        if (!navLinks.contains(e.target) && !navToggle.contains(e.target)) {
            navLinks.classList.remove("is-open");
            navToggle.setAttribute("aria-expanded", "false");
        }
    });

    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
        anchor.addEventListener("click", function (e) {
            const targetId = this.getAttribute("href");
            if (!targetId || targetId === "#") return;
            const targetElement = document.querySelector(targetId);
            if (!targetElement) return;
            e.preventDefault();
            const navHeight = navbar.offsetHeight;
            const top = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
            window.scrollTo({ top: top, behavior: "smooth" });
        });
    });
});
