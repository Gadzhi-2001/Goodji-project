document.addEventListener("DOMContentLoaded", () => {
    const body = document.body;
    const header = document.querySelector(".site-header");
    const menuToggle = document.querySelector(".menu-toggle");
    const mobileMenu = document.querySelector(".mobile-menu");
    const mobileMenuClose = document.querySelector(".mobile-menu__close");
    const mobileMenuOverlay = document.querySelector(".mobile-menu__overlay");
    const navLinks = document.querySelectorAll('a[href^="#"]');
    const revealItems = document.querySelectorAll(".reveal");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const setHeaderState = () => {
        if (!header) {
            return;
        }

        header.classList.toggle("is-scrolled", window.scrollY > 24);
    };

    const openMenu = () => {
        if (!mobileMenu || !menuToggle) {
            return;
        }

        body.classList.add("menu-open");
        mobileMenu.classList.add("is-open");
        mobileMenu.setAttribute("aria-hidden", "false");
        menuToggle.setAttribute("aria-expanded", "true");
    };

    const closeMenu = () => {
        if (!mobileMenu || !menuToggle) {
            return;
        }

        body.classList.remove("menu-open");
        mobileMenu.classList.remove("is-open");
        mobileMenu.setAttribute("aria-hidden", "true");
        menuToggle.setAttribute("aria-expanded", "false");
    };

    if (menuToggle) {
        menuToggle.addEventListener("click", () => {
            const isOpen = mobileMenu?.classList.contains("is-open");
            if (isOpen) {
                closeMenu();
            } else {
                openMenu();
            }
        });
    }

    if (mobileMenuClose) {
        mobileMenuClose.addEventListener("click", closeMenu);
    }

    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener("click", closeMenu);
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeMenu();
        }
    });

    navLinks.forEach((link) => {
        link.addEventListener("click", (event) => {
            const targetId = link.getAttribute("href");

            if (!targetId || !targetId.startsWith("#")) {
                return;
            }

            const target = document.querySelector(targetId);
            if (!target) {
                return;
            }

            event.preventDefault();
            const headerOffset = header ? header.offsetHeight + 12 : 0;
            const targetTop = target.getBoundingClientRect().top + window.scrollY - headerOffset;

            window.scrollTo({
                top: Math.max(targetTop, 0),
                behavior: prefersReducedMotion ? "auto" : "smooth"
            });

            closeMenu();
        });
    });

    setHeaderState();
    window.addEventListener("scroll", setHeaderState, { passive: true });

    if (prefersReducedMotion) {
        revealItems.forEach((item) => item.classList.add("is-visible"));
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        },
        {
            threshold: 0.16,
            rootMargin: "0px 0px -48px 0px"
        }
    );

    revealItems.forEach((item) => observer.observe(item));
});
