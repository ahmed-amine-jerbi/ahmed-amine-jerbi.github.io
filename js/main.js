import { createStackScene } from "./stack-scene.js";

const { gsap, ScrollTrigger, Lenis } = window;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
const root = document.documentElement;

const canvas = document.querySelector(".stack-canvas");
const header = document.querySelector(".site-header");
const tooltip = document.querySelector(".stack-tooltip");
const layerList = document.querySelector(".layers");
const layerItems = [...document.querySelectorAll(".layer")];
const layerNames = layerItems.map((item) => item.querySelector(".layer__name").textContent);

// Timeline units of the skills scroll story: 1 to pull the stack apart, 1 per layer, then a pause.
const STACK_STORY = { apartUnits: 1, perLayerUnits: 1, tailUnits: 0.4 };
const STACK_STORY_TOTAL = STACK_STORY.apartUnits + STACK_STORY.perLayerUnits * (layerItems.length - 1) + STACK_STORY.tailUnits;

const zoomControls = document.querySelector(".stack-controls");
const zoomInButton = zoomControls.querySelector('[data-zoom="in"]');
const zoomOutButton = zoomControls.querySelector('[data-zoom="out"]');
const zoomLevel = zoomControls.querySelector(".stack-controls__level");

const stackScene = createStackScene(canvas, {
  reducedMotion: prefersReducedMotion,
  onLayerHover: showLayerHover,
  onLayerSelect: scrollToLayer,
  onZoomRequest: (factor) => zoomBy(factor),
  onZoomToggle: () => toggleZoom(),
});
const pose = stackScene?.pose;
const canAnimate = !prefersReducedMotion && Boolean(gsap && ScrollTrigger);
let lenis = null;
let stackStoryTrigger = null;
let scrollVelocity = 0;

trackHeaderBorder();
markCurrentNavLink();
bindLayerList();
bindZoomControls();
bindAnchorLinks();
showTunisTime();

if (!stackScene) {
  canvas.hidden = true;
}

if (canAnimate) {
  gsap.registerPlugin(ScrollTrigger);
  startSmoothScroll();
  splitHeroLetters();
  splitTitles();
  choreographStack();
  addParallax();
  addReveals();
  addPointerEffects();
  animateDetails();
  startWhenReady();
} else {
  showStaticPage();
}

/**
 * The intro waits for the fonts and a fully compiled 3D scene, then starts on a fresh frame:
 * started earlier, its first frames would be eaten by shader compiles and font swaps.
 */
async function startWhenReady() {
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  await Promise.race([fontsReady, new Promise((resolve) => setTimeout(resolve, 1500))]);
  stackScene?.warmUp();
  // Decode the screenshots now: decoded on first sight, they stalled the scroll for ~150 ms.
  const images = [...document.querySelectorAll(".shots img")].map((image) => image.decode().catch(() => {}));
  await Promise.race([Promise.all(images), new Promise((resolve) => setTimeout(resolve, 2000))]);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  setTimeout(() => document.querySelector(".font-warmup")?.remove(), 3000);
  // Only visibility changes here, never layout, so no ScrollTrigger refresh is needed: one would
  // stall the first frames of the intro.
  root.classList.remove("is-loading");
  stackScene?.start();
  playIntro();
}

function showTunisTime() {
  const clocks = document.querySelectorAll(".local-time");
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Tunis", hour: "2-digit", minute: "2-digit" });
  const update = () => {
    const now = new Date();
    for (const clock of clocks) {
      clock.textContent = format.format(now);
      clock.dateTime = now.toISOString();
    }
  };
  update();
  setInterval(update, 30_000);
}

/**
 * Reduced motion (or no GSAP): nothing slides, spins, scrubs or moves with the scroll. Things still
 * fade, which is change without movement: the stack fades out after the first screen and back in at
 * the contact section, and content fades in as it is reached.
 */
function showStaticPage() {
  root.classList.remove("is-loading");
  setActiveLayer(-1);
  fadeInOnArrival();
  if (!pose) {
    return;
  }
  stackScene.warmUp();
  stackScene.start();

  const fadeStack = (target) => {
    if (gsap) {
      gsap.to(pose, { visibility: target, duration: 0.5, ease: "power1.inOut", overwrite: true });
    } else {
      pose.visibility = target;
    }
  };
  // The stack keeps its first-screen spot; at the contact section it sits beside the address.
  const contact = document.querySelector("#contact");
  const onScreen = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.isIntersecting ? onScreen.add(entry.target) : onScreen.delete(entry.target);
      }
      // Placed while invisible, so it never visibly jumps: smaller and further right at the contact section.
      if (pose.visibility < 0.05 || onScreen.size === 1) {
        const atContact = onScreen.has(contact) && onScreen.size === 1;
        pose.screenX = atContact ? 0.84 : 0.72;
        pose.screenY = atContact ? 0.56 : 0.48;
        pose.scale = atContact ? 0.7 : 1;
      }
      fadeStack(onScreen.size > 0 ? 1 : 0);
    },
    { threshold: 0.35 },
  );
  observer.observe(document.querySelector(".hero"));
  observer.observe(contact);
}

/** Content fades in (opacity only) the first time it is reached. */
function fadeInOnArrival() {
  const items = document.querySelectorAll("[data-reveal], [data-reveal-group] > *");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-seen");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  for (const item of items) {
    item.classList.add("fade-in");
    observer.observe(item);
  }
}

function startSmoothScroll() {
  if (!Lenis) {
    return;
  }
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on("scroll", (event) => {
    ScrollTrigger.update();
    scrollVelocity = event.velocity;
    if (pose) {
      pose.velocity = event.velocity;
    }
  });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

function bindAnchorLinks() {
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.hash);
      if (!target || !lenis) {
        return;
      }
      event.preventDefault();
      lenis.scrollTo(target, { offset: link.hash === "#top" ? -100 : 0 });
    });
  }
}

function trackHeaderBorder() {
  let isScrolled = null;
  const update = () => {
    const next = window.scrollY > 8;
    if (next !== isScrolled) {
      isScrolled = next;
      header.classList.toggle("is-scrolled", next);
    }
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function markCurrentNavLink() {
  const links = new Map(
    [...document.querySelectorAll(".site-header__nav a")].map((link) => [link.hash.slice(1), link]),
  );
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        // Back on the first screen, no section is current.
        if (entry.target.id === "top" && entry.isIntersecting) {
          links.forEach((other) => other.removeAttribute("aria-current"));
          continue;
        }
        const link = links.get(entry.target.id);
        if (link && entry.isIntersecting) {
          links.forEach((other) => other.removeAttribute("aria-current"));
          link.setAttribute("aria-current", "true");
        }
      }
    },
    { rootMargin: "-45% 0px -45% 0px" },
  );

  for (const id of ["top", ...links.keys()]) {
    const section = document.getElementById(id);
    if (section) {
      observer.observe(section);
    }
  }
}

/* Skills list <-> 3D stack */

let shownLayer = null;

/** A negative focus means no single layer is lit: the whole list reads at full strength. */
function setActiveLayer(focus) {
  const activeIndex = focus < 0 ? -1 : Math.round(focus);
  if (activeIndex === shownLayer) {
    return;
  }
  shownLayer = activeIndex;
  layerList.classList.toggle("is-idle", activeIndex < 0);
  layerItems.forEach((item, index) => item.classList.toggle("is-active", index === activeIndex));
}

function bindLayerList() {
  layerItems.forEach((item, index) => {
    const button = item.querySelector(".layer__button");
    button.addEventListener("click", () => {
      stackScene?.flashLayer(index);
      scrollToLayer(index);
    });
    button.addEventListener("pointerenter", () => setListHover(index));
    button.addEventListener("pointerleave", () => setListHover(-1));
    button.addEventListener("focus", () => setListHover(index));
    button.addEventListener("blur", () => setListHover(-1));
  });
}

function setListHover(index) {
  if (pose) {
    pose.hover = index;
  }
  layerItems.forEach((item, itemIndex) => item.classList.toggle("is-hovered", itemIndex === index));
}

function showLayerHover(index, clientX, clientY) {
  const isVisible = index >= 0;
  tooltip.classList.toggle("is-visible", isVisible);
  if (isVisible) {
    tooltip.textContent = layerNames[index];
    tooltip.style.transform = `translate(${clientX + 18}px, ${clientY + 18}px)`;
  }
  if (pose && pose.hover < 0) {
    layerItems.forEach((item, itemIndex) => item.classList.toggle("is-hovered", itemIndex === index));
  }
}

/** Scrolls the skills story to the point where `index` is the lit layer. */
function scrollToLayer(index) {
  if (!stackStoryTrigger) {
    if (pose) {
      pose.focus = index;
    }
    setActiveLayer(index);
    return;
  }
  // Land a little past the point where the layer lights up, so it is clearly the active one.
  const storyTime = STACK_STORY.apartUnits + STACK_STORY.perLayerUnits * (index + 0.2);
  const progress = storyTime / STACK_STORY_TOTAL;
  const target = stackStoryTrigger.start + (stackStoryTrigger.end - stackStoryTrigger.start) * progress;
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.4 });
  } else {
    window.scrollTo({ top: target, behavior: "smooth" });
  }
}

/* Text splitting */

/** Wraps each letter of the name in a span; the lines clip them, so they can rise from below. */
function splitHeroLetters() {
  for (const line of document.querySelectorAll(".hero__line")) {
    for (const node of [...line.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        const fragment = document.createDocumentFragment();
        for (const letter of node.textContent.trim()) {
          const span = document.createElement("span");
          span.className = "char";
          span.textContent = letter;
          fragment.append(span);
        }
        node.replaceWith(fragment);
      } else if (node instanceof HTMLElement) {
        node.classList.add("char");
      }
    }
  }
}

/** Splits section titles into words inside masks; the number in front stays whole. */
function splitTitles() {
  for (const title of document.querySelectorAll("[data-split]")) {
    for (const node of [...title.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) {
        continue;
      }
      const fragment = document.createDocumentFragment();
      node.textContent.trim().split(/\s+/).forEach((word, index) => {
        if (index > 0) {
          fragment.append(" ");
        }
        const mask = document.createElement("span");
        mask.className = "word-mask";
        const inner = document.createElement("span");
        inner.className = "word";
        inner.textContent = word;
        mask.append(inner);
        fragment.append(mask);
      });
      node.replaceWith(fragment);
    }
  }
}

/* Intro */

/** The one page-load moment: the stack settles together while the name rises in. */
function playIntro() {
  const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });

  if (pose) {
    timeline.fromTo(
      pose,
      { assemble: 0.9, scale: 0.82, visibility: 0 },
      { assemble: 0, scale: 1, visibility: 1, duration: 1.8, ease: "power3.out" },
      0,
    );
  }
  timeline
    .from(".hero__eyebrow", { y: 12, autoAlpha: 0, duration: 0.6 }, 0)
    .from(".hero__line .char", { yPercent: 110, duration: 1.05, stagger: 0.028, ease: "power4.out" }, 0.08)
    .from([".hero__lede", ".hero__actions"], { y: 18, autoAlpha: 0, duration: 0.8, stagger: 0.08 }, 0.55)
    .from(".hero__facts", { autoAlpha: 0, duration: 0.6 }, 0.8)
    .from(".hero__facts > div", { y: 14, autoAlpha: 0, duration: 0.6, stagger: 0.07 }, 0.8)
    .from(".hero__hint", { autoAlpha: 0, duration: 0.6 }, 1.1);
}

/* Scroll story for the 3D stack, all scrubbed with the scroll:
 * hero (assembled) -> skills (pulled apart, one layer lit at a time) -> away while the tool band
 * passes -> arriving again, assembled, at the contact section. */
function choreographStack() {
  if (!pose) {
    setActiveLayer(-1);
    return;
  }

  ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (self) => {
      pose.scroll = self.progress;
    },
  });

  const media = gsap.matchMedia();
  media.add({ isNarrow: "(max-width: 760px)", isWide: "(min-width: 761px)" }, ({ conditions }) => {
    const place = conditions.isNarrow
      ? { hero: [0.5, 0.21], stack: [0.5, 0.26], contact: [0.5, 0.2] }
      : { hero: [0.72, 0.48], stack: [0.68, 0.52], contact: [0.78, 0.52] };
    // Short phones have no room for both the stack and the name, so the stack starts faint.
    const heroDim = conditions.isNarrow && window.innerHeight < 700 ? 0.25 : 1;

    const syncList = () => setActiveLayer(pose.focus);
    gsap.ticker.add(syncList);

    gsap.set(pose, {
      screenX: place.hero[0],
      screenY: place.hero[1],
      spread: 0,
      focus: -1,
      turn: 0,
      tilt: 0,
      dim: heroDim,
      contactX: place.contact[0],
      contactY: place.contact[1],
      contactScale: 0.8,
      // On a phone the stack sits behind the contact text, so it stays faint there.
      contactDim: conditions.isNarrow ? 0.3 : 1,
    });
    setActiveLayer(-1);

    gsap.to(pose, {
      screenX: place.stack[0],
      screenY: place.stack[1],
      turn: 0.35,
      dim: 1,
      ease: "none",
      scrollTrigger: { trigger: "#stack", start: "top bottom", end: "top top", scrub: 0.6 },
    });

    const story = gsap
      .timeline({ scrollTrigger: { trigger: "#stack", start: "top top", end: "bottom bottom", scrub: 0.6 } })
      .to(pose, { spread: 1, tilt: 0.08, duration: STACK_STORY.apartUnits, ease: "power1.inOut" })
      .set(pose, { focus: 0 })
      .to(pose, { focus: layerItems.length - 1, turn: 0.9, duration: STACK_STORY.perLayerUnits * (layerItems.length - 1), ease: "none" })
      .to({}, { duration: STACK_STORY.tailUnits });
    stackStoryTrigger = story.scrollTrigger;

    // Leaving the skills: scrubbed while the tool band crosses the screen, so the stack folds,
    // spins and drifts away with the scroll (and comes back the same way when scrolling up).
    const leave = gsap.fromTo(
      pose,
      { away: 0 },
      { away: 1, ease: "none", immediateRender: false, scrollTrigger: { trigger: ".ticker", start: "top bottom", end: "bottom 30%", scrub: 0.8 } },
    );
    // Reaching the contact section: it rises in from below and assembles as the section arrives.
    const arrive = gsap.fromTo(
      pose,
      { arrive: 0 },
      { arrive: 1, ease: "none", immediateRender: false, scrollTrigger: { trigger: "#contact", start: "top bottom", end: "top 30%", scrub: 0.8 } },
    );

    return () => {
      gsap.ticker.remove(syncList);
      leave.scrollTrigger?.kill();
      arrive.scrollTrigger?.kill();
    };
  });
}

/* Zoom: buttons, double-click, pinch / Ctrl + wheel over the stack, and the + / - / 0 keys. */

const ZOOM = { min: 0.6, max: 2.2, step: 1.3, toggled: 1.6 };
let zoomTarget = 1;

function zoomTo(value) {
  if (!pose) {
    return;
  }
  zoomTarget = Math.min(ZOOM.max, Math.max(ZOOM.min, value));
  if (gsap) {
    gsap.to(pose, { zoom: zoomTarget, duration: prefersReducedMotion ? 0 : 0.7, ease: "power3.out", overwrite: "auto" });
  } else {
    pose.zoom = zoomTarget;
  }
  zoomLevel.textContent = `${Math.round(zoomTarget * 100)}%`;
  zoomOutButton.disabled = zoomTarget <= ZOOM.min + 0.001;
  zoomInButton.disabled = zoomTarget >= ZOOM.max - 0.001;
}

function zoomBy(factor) {
  zoomTo(zoomTarget * factor);
}

function toggleZoom() {
  zoomTo(zoomTarget > 1.15 ? 1 : ZOOM.toggled);
}

function resetView() {
  zoomTo(1);
  stackScene?.resetView();
}

function bindZoomControls() {
  if (!stackScene) {
    zoomControls.hidden = true;
    return;
  }

  zoomInButton.addEventListener("click", () => zoomBy(ZOOM.step));
  zoomOutButton.addEventListener("click", () => zoomBy(1 / ZOOM.step));
  zoomControls.querySelector('[data-zoom="reset"]').addEventListener("click", resetView);

  window.addEventListener("keydown", (event) => {
    const isTyping = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]");
    if (isTyping || event.ctrlKey || event.metaKey || !zoomControls.classList.contains("is-visible")) {
      return;
    }
    if (event.key === "+" || event.key === "=") {
      zoomBy(ZOOM.step);
    } else if (event.key === "-" || event.key === "_") {
      zoomBy(1 / ZOOM.step);
    } else if (event.key === "0") {
      resetView();
    }
  });

  // The controls show only while the stack is on screen; the class changes only on a real change.
  let isShown = false;
  const watch = () => {
    const shouldShow = pose.shown > 0.85;
    if (shouldShow !== isShown) {
      isShown = shouldShow;
      zoomControls.classList.toggle("is-visible", shouldShow);
    }
  };
  if (gsap) {
    gsap.ticker.add(watch);
  } else {
    setInterval(watch, 250);
  }
}

/* Parallax: layers of the page move at different speeds as you scroll up and down. */

function addParallax() {
  startTicker();

  gsap.to(".scroll-progress", { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });

  // The grid drifts at a third of the scroll speed, so it reads as a far-away surface.
  gsap.to(".backdrop__grid", { y: () => -window.innerHeight * 0.35, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: true, invalidateOnRefresh: true } });

  const heroScroll = { trigger: ".hero", start: "top top", end: "bottom top", scrub: true };
  gsap.to(".hero__text", { yPercent: -16, autoAlpha: 0.1, ease: "none", scrollTrigger: heroScroll });
  gsap.to(".hero__facts, .hero__hint", { y: -60, autoAlpha: 0, ease: "none", scrollTrigger: { ...heroScroll, end: "40% top" } });
  [-6, 3, 9].forEach((shift, index) => {
    gsap.to(`.hero__line:nth-child(${index + 1})`, { xPercent: shift, ease: "none", scrollTrigger: heroScroll });
  });

  // Anything with data-speed moves against the scroll: positive is slower (further away).
  for (const element of document.querySelectorAll("[data-speed]")) {
    const distance = Number(element.dataset.speed) * 70;
    gsap.fromTo(
      element,
      { y: distance },
      { y: -distance, ease: "none", scrollTrigger: { trigger: element, start: "top bottom", end: "bottom top", scrub: true } },
    );
  }

  // The front Marketlens screenshot lies back and stands up as it arrives.
  const frame = document.querySelector("[data-frame]");
  if (frame) {
    gsap.fromTo(
      frame,
      { rotateX: 24, rotateY: -12, scale: 0.88, transformPerspective: 1400 },
      { rotateX: 0, rotateY: 0, scale: 1, ease: "none", scrollTrigger: { trigger: frame, start: "top bottom", end: "center 60%", scrub: 0.6 } },
    );
  }
}

/** The tool band drifts on its own and speeds up (or reverses) with the scroll. One ticker
 *  function eases the speed; nothing is created per scroll event. */
function startTicker() {
  const tweens = [...document.querySelectorAll(".ticker__row")].map((row) => {
    const isReverse = row.classList.contains("ticker__row--reverse");
    return gsap.fromTo(row, { xPercent: isReverse ? -50 : 0 }, { xPercent: isReverse ? 0 : -50, duration: 40, ease: "none", repeat: -1 });
  });
  let speed = 1;
  let direction = 1;
  const steer = () => {
    if (Math.abs(scrollVelocity) > 0.5) {
      direction = scrollVelocity < 0 ? -1 : 1;
    }
    const target = direction * Math.min(6, 1 + Math.abs(scrollVelocity) * 0.12);
    speed += (target - speed) * 0.08;
    for (const tween of tweens) {
      tween.timeScale(speed);
    }
  };

  // Off screen, the band and its steering stop completely.
  ScrollTrigger.create({
    trigger: ".ticker",
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => {
      for (const tween of tweens) {
        self.isActive ? tween.resume() : tween.pause();
      }
      self.isActive ? gsap.ticker.add(steer) : gsap.ticker.remove(steer);
    },
  });
  for (const tween of tweens) {
    tween.pause();
  }
}

/* Reveals: things rise into place as they come into view and sink back when you scroll up past them. */

function addReveals() {
  const items = gsap.utils.toArray("[data-reveal]");
  gsap.set(items, { autoAlpha: 0, y: 48 });
  ScrollTrigger.batch(items, {
    start: "top 88%",
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.12, overwrite: true }),
    onLeaveBack: (batch) => gsap.to(batch, { autoAlpha: 0, y: 48, duration: 0.45, ease: "power2.in", overwrite: true }),
  });

  for (const group of document.querySelectorAll("[data-reveal-group]")) {
    const children = [...group.children];
    gsap.set(children, { autoAlpha: 0, y: 18 });
    ScrollTrigger.create({
      trigger: group,
      start: "top 90%",
      onEnter: () => gsap.to(children, { autoAlpha: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.07, overwrite: true }),
      onLeaveBack: () => gsap.to(children, { autoAlpha: 0, y: 18, duration: 0.35, ease: "power2.in", overwrite: true }),
    });
  }

  for (const title of document.querySelectorAll("[data-split]")) {
    const words = title.querySelectorAll(".word");
    gsap.set(words, { yPercent: 110 });
    ScrollTrigger.create({
      trigger: title,
      start: "top 85%",
      onEnter: () => {
        gsap.to(words, { yPercent: 0, duration: 1, ease: "power4.out", stagger: 0.06, overwrite: true });
      },
      onLeaveBack: () => {
        gsap.to(words, { yPercent: 110, duration: 0.4, ease: "power2.in", overwrite: true });
      },
    });
  }

  // Numbers count up from zero the first time they are seen.
  for (const counter of document.querySelectorAll("[data-count]")) {
    const target = Number(counter.dataset.count);
    const state = { value: 0 };
    ScrollTrigger.create({
      trigger: counter,
      start: "top 92%",
      once: true,
      onEnter: () =>
        gsap.to(state, {
          value: target,
          duration: 1.4,
          ease: "power2.out",
          onUpdate: () => {
            counter.textContent = Math.round(state.value);
          },
        }),
    });
    counter.textContent = "0";
  }
}

/* Pointer: the screenshots tilt toward the cursor and the hero name follows it a little. */

function addPointerEffects() {
  if (!hasFinePointer) {
    return;
  }

  const shots = document.querySelector(".shots");
  if (shots) {
    gsap.set(shots, { transformPerspective: 1200 });
    // One tween per frame at most, whatever the pointer event rate.
    const tilt = { x: 0, y: 0, frame: 0 };
    const applyTilt = () => {
      tilt.frame = 0;
      gsap.to(shots, { rotateX: tilt.x, rotateY: tilt.y, duration: 0.6, ease: "power3.out", overwrite: "auto" });
    };
    const requestTilt = (x, y) => {
      tilt.x = x;
      tilt.y = y;
      tilt.frame ||= requestAnimationFrame(applyTilt);
    };
    let bounds = null;
    shots.addEventListener("pointerenter", () => {
      bounds = shots.getBoundingClientRect();
    });
    shots.addEventListener("pointermove", (event) => {
      bounds ??= shots.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width;
      const y = (event.clientY - bounds.top) / bounds.height;
      requestTilt((0.5 - y) * 6, (x - 0.5) * 8);
    });
    shots.addEventListener("pointerleave", () => {
      bounds = null;
      requestTilt(0, 0);
    });
  }

  gsap.set(".hero__title", { x: 0.01, y: 0.01 });
  const heroX = gsap.quickTo(".hero__title", "x", { duration: 1, ease: "power3.out" });
  const heroY = gsap.quickTo(".hero__title", "y", { duration: 1, ease: "power3.out" });
  window.addEventListener(
    "pointermove",
    (event) => {
      if (window.scrollY > window.innerHeight) {
        return;
      }
      heroX((event.clientX / window.innerWidth - 0.5) * -16);
      heroY((event.clientY / window.innerHeight - 0.5) * -8);
    },
    { passive: true },
  );
}

/* Smaller moments that explain the content as it arrives. */

function animateDetails() {
  drawClaimFlow();

  gsap.from(".schema__table", {
    y: 20,
    autoAlpha: 0,
    duration: 0.6,
    ease: "power3.out",
    stagger: 0.045,
    scrollTrigger: { trigger: ".schema", start: "top 80%", toggleActions: "play none none reverse" },
  });
  gsap.from(".shared-db > *", {
    autoAlpha: 0,
    scale: 0.9,
    duration: 0.5,
    ease: "power3.out",
    stagger: 0.08,
    scrollTrigger: { trigger: ".shared-db", start: "top 85%", toggleActions: "play none none reverse" },
  });

  // The rail fills with the scroll; item positions are measured once per layout, not per frame.
  const timeline = document.querySelector(".timeline");
  const timelineItems = [...timeline.querySelectorAll(".timeline__item")];
  let itemTops = [];
  let railHeight = 1;
  ScrollTrigger.create({
    trigger: timeline,
    start: "top 75%",
    end: "bottom 55%",
    scrub: true,
    onRefresh: () => {
      railHeight = timeline.offsetHeight;
      itemTops = timelineItems.map((item) => item.offsetTop);
    },
    onUpdate: (self) => {
      timeline.style.setProperty("--rail", self.progress.toFixed(3));
      const reached = self.progress * railHeight + 8;
      timelineItems.forEach((item, index) => item.classList.toggle("is-reached", itemTops[index] <= reached));
    },
  });
}

/** Draws the ReturnFlow diagram in the order a claim travels, then sends a claim through it. */
function drawClaimFlow() {
  const nodes = document.querySelectorAll(".flow__node");
  const solidPaths = document.querySelectorAll(".flow__lines path:not(.flow__dashed)");
  const dashedPaths = document.querySelectorAll(".flow__lines .flow__dashed");
  const drawing = gsap.timeline({ scrollTrigger: { trigger: ".flow", start: "top 85%", end: "center 50%", scrub: 0.5 } });

  drawing.from(nodes, { autoAlpha: 0, scale: 0.85, duration: 0.4, stagger: 0.25, ease: "power2.out" }, 0);
  solidPaths.forEach((path, index) => {
    const length = path.getTotalLength();
    gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
    drawing.to(path, { strokeDashoffset: 0, duration: 0.5, ease: "none" }, 0.2 + index * 0.25);
  });
  drawing.from(dashedPaths, { autoAlpha: 0, duration: 0.4 });

  // Claim filed -> AI analysis -> policy -> agent queue -> agent decides.
  const route = [[60, 60], [235, 60], [410, 60], [410, 140], [300, 140], [300, 210], [300, 280]];
  const packet = document.querySelector(".flow__packet");
  const journey = gsap.timeline({ repeat: -1, repeatDelay: 0.6, paused: true });
  journey.set(packet, { attr: { cx: route[0][0], cy: route[0][1] }, opacity: 0 }).to(packet, { opacity: 1, duration: 0.2 });
  for (const [x, y] of route.slice(1)) {
    journey.to(packet, { attr: { cx: x, cy: y }, duration: 0.45, ease: "power1.inOut" });
  }
  journey.to(packet, { opacity: 0, duration: 0.3 });

  ScrollTrigger.create({
    trigger: ".flow",
    start: "center 60%",
    end: "bottom top",
    onToggle: (self) => (self.isActive ? journey.play() : journey.pause()),
  });
}
