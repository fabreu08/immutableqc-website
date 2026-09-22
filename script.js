document.addEventListener("DOMContentLoaded", function () {
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var navbar = document.getElementById("navbar");
    var navToggle = document.getElementById("navToggle");
    var navLinks = document.getElementById("navLinks");
    var hero = document.getElementById("hero");
    var heroVisual = document.getElementById("heroVisual");
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

    // How-it-works: flow injection sequence scrubbed by scroll
    (function initFlowSequence() {
        var how = document.getElementById("how-it-works");
        var track = document.getElementById("howTrack");
        var stage = document.getElementById("howStage");
        var list = document.getElementById("howList");
        var steps = document.getElementById("howSteps");
        var diagram = document.getElementById("howDiagram");
        var hint = document.getElementById("howHint");
        var rail = document.getElementById("howRail");
        var railFill = document.getElementById("howRailFill");
        var svg = document.getElementById("fiaSvg");
        if (!how || !track || !stage || !list || !steps || !svg) return;

        var $ = function (id) { return document.getElementById(id); };
        var el = {
            clock: $("fiaClock"),
            needle: $("fiaNeedle"),
            vialFill: $("fiaVialFill"),
            rollers: $("fiaRollers"),
            detGlow: $("fiaDetGlow"),
            tube: $("fiaTube"),
            carrier: $("fiaCarrier"),
            bands: [$("fiaBand0"), $("fiaBand1"), $("fiaBand2")],
            clip: $("fiaTraceClipRect"),
            trace: $("fiaTrace"),
            pfills: [$("fiaPfill0"), $("fiaPfill1"), $("fiaPfill2")],
            pen: $("fiaPen"),
            pks: [$("fiaPk0"), $("fiaPk1"), $("fiaPk2")],
            rt: [$("fiaRt0"), $("fiaRt1"), $("fiaRt2")],
            rtU: $("fiaRtU"),
            rowInj: $("fiaRowInj"),
            rowFlow: $("fiaRowFlow"),
            rowDil: $("fiaRowDil"),
            rowDilAmd: $("fiaRowDilAmd"),
            rowRes: $("fiaRowRes"),
            rowResAmd: $("fiaRowResAmd"),
            rowHash: $("fiaRowHash"),
            rowAmd: $("fiaRowAmd"),
            blks: [$("fiaBlk1"), $("fiaBlk2"), $("fiaBlk3"), $("fiaBlk4")],
            lnks: [$("fiaLnk1"), $("fiaLnk2"), $("fiaLnk3"), $("fiaLnk4")],
            back: $("fiaBack"),
            intact: $("fiaIntact"),
            recs: [$("rec0"), $("rec1"), $("rec2"), $("rec3"), $("rec4")]
        };
        var stepEls = Array.prototype.slice.call(steps.querySelectorAll(".how__step"));
        var numEls = stepEls.map(function (s) { return s.querySelector(".how__num"); });

        // Timeline (fractions of the pinned scroll range)
        var STAGES = [0, 0.16, 0.38, 0.70, 0.85, 1.0001];
        var T = {
            needleDown: [0.00, 0.05],
            aspirate: [0.05, 0.11],
            injRec: 0.11,
            needleUp: [0.11, 0.15],
            move: [0.16, 0.38],
            colEnter: 0.38,
            det: [0.40, 0.70],
            peaksRec: 0.665,
            rptRows: 0.72,
            rptHash: [0.74, 0.79],
            rptRec: 0.79,
            amdDil: 0.88,
            amdRes: 0.905,
            amdRec: 0.925,
            backLink: [0.925, 0.975],
            intact: 0.975
        };
        var PLOT = { x0: 32, x1: 348, base: 272, top: 184 };
        var PEAKS = [
            { p: 0.454, sigma: 0.028, h: 0.86 },
            { p: 0.529, sigma: 0.034, h: 0.56 },
            { p: 0.613, sigma: 0.042, h: 0.40 }
        ];
        var detSpan = T.det[1] - T.det[0];
        PEAKS.forEach(function (pk) {
            pk.t = (pk.p - T.det[0]) / detSpan;
            pk.done = pk.p + detSpan * 3 * pk.sigma;
        });

        function clamp(v, lo, hi) {
            if (lo === undefined) { lo = 0; hi = 1; }
            return Math.max(lo, Math.min(hi, v));
        }
        function lerp(a, b, t) { return a + (b - a) * t; }
        function norm(p, range) { return clamp((p - range[0]) / (range[1] - range[0])); }
        function ease(t) { return t * t * (3 - 2 * t); }
        function toggle(node, on, cls) {
            if (node) node.classList.toggle(cls || "is-on", !!on);
        }

        // Tube geometry: normalize landmarks to pathLength 1000
        var tubeD = el.tube.getAttribute("d");
        el.carrier.setAttribute("d", tubeD);
        el.bands.forEach(function (b) { b.setAttribute("d", tubeD); });
        var S = { colIn: 640, det: 820, end: 1000 };
        try {
            var L = el.tube.getTotalLength();
            var n = 1200;
            var foundCol = false, foundDet = false;
            for (var i = 0; i <= n; i++) {
                var pt = el.tube.getPointAtLength((i / n) * L);
                if (!foundCol && pt.x >= 372 && Math.abs(pt.y - 34) < 1) { S.colIn = (i / n) * 1000; foundCol = true; }
                if (!foundDet && Math.abs(pt.x - 488) < 1 && pt.y >= 78) { S.det = (i / n) * 1000; foundDet = true; }
            }
        } catch (e) { /* keep defaults */ }

        // Chromatogram trace + peak fills
        var PW = PLOT.x1 - PLOT.x0;
        var PH = PLOT.base - PLOT.top;
        function signal(t, only) {
            var y = 0;
            for (var k = 0; k < PEAKS.length; k++) {
                if (only !== undefined && only !== k) continue;
                var dt = (t - PEAKS[k].t) / PEAKS[k].sigma;
                y += PEAKS[k].h * Math.exp(-0.5 * dt * dt);
            }
            if (only === undefined) {
                y += 0.006 * Math.sin(t * 140) + 0.004 * Math.sin(t * 37 + 1.3) + 0.012 * t;
            }
            return y;
        }
        function traceY(t) { return PLOT.base - signal(t) * PH; }
        (function buildTrace() {
            var N = 320, d = "";
            for (var i = 0; i <= N; i++) {
                var t = i / N;
                d += (i ? " L " : "M ") + (PLOT.x0 + t * PW).toFixed(2) + " " + traceY(t).toFixed(2);
            }
            el.trace.setAttribute("d", d);
            PEAKS.forEach(function (pk, k) {
                var t0 = Math.max(0, pk.t - 3.5 * pk.sigma), t1 = Math.min(1, pk.t + 3.5 * pk.sigma);
                var M = 60, fd = "M " + (PLOT.x0 + t0 * PW).toFixed(2) + " " + PLOT.base;
                for (var j = 0; j <= M; j++) {
                    var t = lerp(t0, t1, j / M);
                    fd += " L " + (PLOT.x0 + t * PW).toFixed(2) + " " + (PLOT.base - signal(t, k) * PH).toFixed(2);
                }
                fd += " L " + (PLOT.x0 + t1 * PW).toFixed(2) + " " + PLOT.base + " Z";
                el.pfills[k].setAttribute("d", fd);
                el.pks[k].setAttribute("x", (PLOT.x0 + pk.t * PW).toFixed(1));
                el.pks[k].setAttribute("y", (PLOT.base - pk.h * PH - 7).toFixed(1));
                el.pks[k].textContent = (pk.t * 8).toFixed(2);
            });
        })();

        function setBand(i, center, len) {
            var b = el.bands[i];
            if (len <= 0.5) { b.style.strokeDasharray = "0 3000"; return; }
            b.style.strokeDasharray = len.toFixed(2) + " 3000";
            b.style.strokeDashoffset = (-(center - len / 2)).toFixed(2);
        }

        var HEX = "0123456789abcdef";
        function scrambled(p) {
            var seed = Math.floor(p * 900), out = "sha256:";
            for (var i = 0; i < 4; i++) out += HEX[(seed * 31 + i * 7) % 16];
            out += "…";
            for (var j = 0; j < 4; j++) out += HEX[(seed * 17 + j * 11 + 5) % 16];
            return out;
        }
        function clockText(p) {
            var run = clamp((p - T.move[0]) / (T.det[1] - T.move[0]));
            var s = run * 480;
            var mm = Math.floor(s / 60), ss = s - mm * 60;
            var txt = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss.toFixed(1);
            return p >= T.det[1] ? "run complete · " + txt : "t = " + txt;
        }

        var currentStage = -1;
        function setStage(k) {
            if (k === currentStage) return;
            currentStage = k;
            stepEls.forEach(function (s, idx) {
                s.classList.toggle("is-active", idx === k);
                s.classList.toggle("is-done", idx < k);
                var btn = s.querySelector(".how__btn");
                if (btn) {
                    if (idx === k) btn.setAttribute("aria-current", "step");
                    else btn.removeAttribute("aria-current");
                }
            });
        }
        function stageOf(p) {
            var k = 0;
            for (var i = 0; i < STAGES.length - 1; i++) if (p >= STAGES[i]) k = i;
            return k;
        }

        function updateRail(p, k) {
            if (!rail || !railFill || !numEls[0]) return;
            var listTop = list.getBoundingClientRect().top;
            var centers = numEls.map(function (n) {
                var r = n.getBoundingClientRect();
                return r.top - listTop + r.height / 2;
            });
            var top = centers[0], bottom = centers[centers.length - 1];
            rail.style.top = top + "px";
            rail.style.height = Math.max(0, bottom - top) + "px";
            var frac = norm(p, [STAGES[k], STAGES[k + 1]]);
            var next = k + 1 < centers.length ? centers[k + 1] : centers[k];
            var fill = lerp(centers[k], next, frac) - top;
            railFill.style.height = clamp(fill, 0, bottom - top) + "px";
        }

        function render(p) {
            p = clamp(p);
            var k = stageOf(p);
            setStage(k);
            updateRail(p, k);

            // Autosampler: needle travel and aspiration
            var ny;
            if (p < T.needleDown[1]) ny = lerp(66, 96, ease(norm(p, T.needleDown)));
            else if (p < T.needleUp[0]) ny = 96;
            else if (p < T.needleUp[1]) ny = lerp(96, 66, ease(norm(p, T.needleUp)));
            else ny = 66;
            el.needle.setAttribute("y2", ny.toFixed(2));
            var asp = norm(p, T.aspirate);
            el.vialFill.setAttribute("r", lerp(5, 2.6, asp).toFixed(2));

            // Sample bands along the tubing
            var glow = 0;
            for (var i = 0; i < 3; i++) {
                var fullLen = 24 + i * 8;
                if (p < T.move[0]) {
                    if (i === 0) { var l0 = 24 * asp; setBand(0, l0 / 2, l0); }
                    else setBand(i, 0, 0);
                    continue;
                }
                if (p < T.colEnter) {
                    if (i === 0) setBand(0, lerp(0, S.colIn, norm(p, T.move)), 24);
                    else setBand(i, 0, 0);
                    continue;
                }
                var pk = PEAKS[i];
                var center = p < pk.p
                    ? lerp(S.colIn, S.det, norm(p, [T.colEnter, pk.p]))
                    : lerp(S.det, S.end + fullLen, norm(p, [pk.p, pk.p + 0.08]));
                var len = lerp(24, fullLen, clamp((p - T.colEnter) / 0.06));
                setBand(i, center, len);
                if (i > 0) el.bands[i].style.strokeOpacity = clamp((p - T.colEnter) / 0.03).toFixed(2);
                var dz = (center - S.det) / 16;
                glow += Math.exp(-dz * dz);
            }
            el.detGlow.style.opacity = clamp(glow).toFixed(2);

            // Pump rotor turns while the run is flowing
            var rot = clamp((p - T.move[0]) / (T.det[1] - T.move[0])) * 900;
            el.rollers.setAttribute("transform", "rotate(" + rot.toFixed(1) + " 250 88)");

            // Detector trace
            var d = norm(p, T.det);
            el.clip.setAttribute("width", (d * PW).toFixed(2));
            if (d > 0 && d < 1) {
                el.pen.setAttribute("cx", (PLOT.x0 + d * PW).toFixed(2));
                el.pen.setAttribute("cy", traceY(d).toFixed(2));
                el.pen.style.opacity = "1";
            } else {
                el.pen.style.opacity = "0";
            }
            PEAKS.forEach(function (pk, idx) {
                toggle(el.pks[idx], p >= pk.done);
                toggle(el.rt[idx], p >= pk.done);
            });
            toggle(el.rtU, p >= PEAKS[2].done);

            // Run record rows
            toggle(el.rowInj, p >= T.injRec);
            toggle(el.rowFlow, p >= T.move[0]);
            toggle(el.rowDil, p >= T.rptRows && p < T.amdDil);
            toggle(el.rowDilAmd, p >= T.amdDil);
            toggle(el.rowRes, p >= T.rptRows && p < T.amdRes);
            toggle(el.rowResAmd, p >= T.amdRes);
            if (p < T.rptHash[0]) {
                toggle(el.rowHash, false);
            } else {
                toggle(el.rowHash, true);
                el.rowHash.textContent = p < T.rptHash[1] ? scrambled(p) : "sha256:9c2e…41b7";
            }
            toggle(el.rowAmd, p >= T.amdRec);

            // Ledger blocks
            var written = [p >= T.injRec, p >= T.peaksRec, p >= T.rptRec, p >= T.amdRec];
            var latest = -1;
            written.forEach(function (on, idx) {
                toggle(el.blks[idx], on);
                toggle(el.lnks[idx], on);
                if (on) latest = idx;
            });
            el.blks.forEach(function (b, idx) { toggle(b, idx === latest, "is-latest"); });
            var bl = norm(p, T.backLink);
            toggle(el.back, bl > 0);
            el.back.style.strokeDashoffset = (100 - 100 * bl).toFixed(2);
            toggle(el.intact, p >= T.intact);

            // Step chips
            toggle(el.recs[0], p >= T.injRec);
            toggle(el.recs[1], p >= T.move[0]);
            toggle(el.recs[2], p >= T.peaksRec);
            toggle(el.recs[3], p >= T.rptRec);
            toggle(el.recs[4], p >= T.amdRec);

            el.clock.textContent = clockText(p);
            toggle(hint, p >= 0.03, "is-hidden");
        }

        var isMobile = window.matchMedia("(max-width: 860px)");
        function stickyTop() {
            var v = parseFloat(window.getComputedStyle(stage).top);
            return isNaN(v) ? 0 : v;
        }

        function pinRange() {
            var vh = window.innerHeight || 1;
            if (isMobile.matches) {
                var r = list.getBoundingClientRect();
                var top = r.top + window.pageYOffset - vh * 0.72;
                return { start: top, length: Math.max(1, r.height) };
            }
            var tr = track.getBoundingClientRect();
            var trackTop = tr.top + window.pageYOffset;
            var length = track.offsetHeight - stage.offsetHeight;
            if (length < 40) {
                return { start: trackTop - vh * 0.6, length: Math.max(1, track.offsetHeight) };
            }
            return { start: trackTop - stickyTop(), length: length };
        }
        function progressFromScroll() {
            var r = pinRange();
            return (window.pageYOffset - r.start) / r.length;
        }

        // Click a step: seek the run to that stage
        steps.querySelectorAll(".how__btn").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var k = parseInt(btn.getAttribute("data-step"), 10);
                if (isNaN(k)) return;
                if (reducedMotion) {
                    render(STAGES[k + 1] - 0.002);
                    setStage(k);
                    return;
                }
                var r = pinRange();
                var target = r.start + (STAGES[k] + 0.006) * r.length;
                window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
            });
        });

        if (reducedMotion) {
            how.classList.add("how--static");
            render(1);
            setStage(0);
            return;
        }

        var ticking = false;
        function onScroll() {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(function () {
                ticking = false;
                render(progressFromScroll());
            });
        }
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });
        if (isMobile.addEventListener) isMobile.addEventListener("change", onScroll);
        render(progressFromScroll());
        // Layout settles (fonts, images) after first paint; re-measure once more
        window.setTimeout(onScroll, 300);

        // Carrier stream animates only while the diagram is on screen
        if (diagram && "IntersectionObserver" in window) {
            var liveObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    diagram.classList.toggle("is-live", entry.isIntersecting);
                });
            }, { threshold: 0.1 });
            liveObserver.observe(diagram);
        }
    })();

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
