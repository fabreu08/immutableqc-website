document.addEventListener("DOMContentLoaded", function () {
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var navbar = document.getElementById("navbar");
    var navToggle = document.getElementById("navToggle");
    var navLinks = document.getElementById("navLinks");
    var hero = document.getElementById("hero");
    var heroVisual = document.getElementById("heroVisual");
    var howSteps = document.getElementById("howSteps");
    var howDiagram = document.getElementById("howDiagram");
    var howTrack = document.getElementById("howTrack");
    var tamperStage = document.getElementById("tamperStage");

    function updateNavState() {
        if (!navbar) return;
        navbar.classList.toggle("nav--scrolled", window.scrollY > 24);
    }
    window.addEventListener("scroll", updateNavState, { passive: true });
    updateNavState();

    if (navToggle && navLinks) {
        navToggle.addEventListener("click", function () {
            var isOpen = navLinks.classList.toggle("is-open");
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
    }

    // Smooth-ish anchor scroll; honor reduced motion
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
        anchor.addEventListener("click", function (e) {
            var targetId = this.getAttribute("href");
            if (!targetId || targetId === "#") return;
            var targetElement = document.querySelector(targetId);
            if (!targetElement) return;
            e.preventDefault();
            var navHeight = navbar ? navbar.offsetHeight : 0;
            var top = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight - 12;
            window.scrollTo({
                top: top,
                behavior: reducedMotion ? "auto" : "smooth"
            });
        });
    });

    // Hero entrance (once)
    if (hero) {
        requestAnimationFrame(function () {
            hero.classList.add("is-ready");
        });
    }

    // Hero seal loop: play when onscreen, pause on hover, static if reduced motion
    if (heroVisual) {
        if (reducedMotion) {
            heroVisual.classList.add("is-static");
        } else {
            var heroObserver = new IntersectionObserver(
                function (entries) {
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting) {
                            heroVisual.classList.add("is-playing");
                            heroVisual.classList.remove("is-static");
                        } else {
                            heroVisual.classList.remove("is-playing");
                            heroVisual.classList.add("is-static");
                        }
                    });
                },
                { threshold: 0.25 }
            );
            heroObserver.observe(heroVisual);

            heroVisual.addEventListener("mouseenter", function () {
                heroVisual.classList.add("is-paused");
            });
            heroVisual.addEventListener("mouseleave", function () {
                heroVisual.classList.remove("is-paused");
            });
        }
    }

    // How-it-works: activate step on scroll + click; update diagram
    function setHowStep(index) {
        if (!howSteps || !howDiagram) return;
        var steps = howSteps.querySelectorAll(".how__step");
        var diags = howDiagram.querySelectorAll(".diag");
        var i = Math.max(0, Math.min(index, steps.length - 1));

        steps.forEach(function (step, idx) {
            step.classList.toggle("is-active", idx === i);
        });
        diags.forEach(function (diag, idx) {
            diag.classList.toggle("is-shown", idx === i);
        });
    }

    if (howSteps) {
        var stepEls = howSteps.querySelectorAll(".how__step");
        var lastHowIdx = -1;

        howSteps.querySelectorAll(".how__btn").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var step = parseInt(btn.getAttribute("data-step"), 10);
                if (!isNaN(step)) {
                    lastHowIdx = step;
                    setHowStep(step);
                }
            });
        });

        function updateHowFromScroll() {
            if (!stepEls.length) return;

            // Desktop: tall track with sticky stage — map scroll progress to step
            if (howTrack && howTrack.offsetHeight > window.innerHeight * 1.2) {
                var rect = howTrack.getBoundingClientRect();
                var trackH = howTrack.offsetHeight;
                var vh = window.innerHeight || 1;
                var scrolled = -rect.top + vh * 0.2;
                var range = Math.max(1, trackH - vh * 0.55);
                var progress = scrolled / range;
                progress = Math.max(0, Math.min(0.999, progress));
                var idx = Math.floor(progress * stepEls.length);
                if (idx !== lastHowIdx) {
                    lastHowIdx = idx;
                    setHowStep(idx);
                }
                return;
            }

            // Mobile / short track: pick the step nearest viewport center
            var center = (window.innerHeight || 0) * 0.4;
            var best = 0;
            var bestDist = Infinity;
            stepEls.forEach(function (el, idx) {
                var r = el.getBoundingClientRect();
                var mid = r.top + r.height / 2;
                var dist = Math.abs(mid - center);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = idx;
                }
            });
            if (best !== lastHowIdx) {
                lastHowIdx = best;
                setHowStep(best);
            }
        }

        window.addEventListener("scroll", updateHowFromScroll, { passive: true });
        window.addEventListener("resize", updateHowFromScroll, { passive: true });
        updateHowFromScroll();
        if (lastHowIdx < 0) setHowStep(0);
    }

    // Tamper beat: one-shot on intersect
    if (tamperStage) {
        if (reducedMotion) {
            tamperStage.classList.add("is-done");
        } else {
            var fired = false;
            var tamperObserver = new IntersectionObserver(
                function (entries) {
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting && !fired) {
                            fired = true;
                            tamperStage.classList.add("is-animating");
                            window.setTimeout(function () {
                                tamperStage.classList.remove("is-animating");
                                tamperStage.classList.add("is-done");
                            }, 2600);
                            tamperObserver.disconnect();
                        }
                    });
                },
                { threshold: 0.45 }
            );
            tamperObserver.observe(tamperStage);
        }
    }
});
