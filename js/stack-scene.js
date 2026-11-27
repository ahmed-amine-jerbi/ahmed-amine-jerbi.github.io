import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  WebGLRenderer,
} from "../vendor/three.module.min.js";
import { RoundedBoxGeometry } from "../vendor/three-addons/RoundedBoxGeometry.js";
import { RoomEnvironment } from "../vendor/three-addons/RoomEnvironment.js";

const PLATE = { width: 3.4, depth: 2.4, height: 0.12, radius: 0.06 };
const ON_PLATE = PLATE.height / 2;
const SPACING_COLLAPSED = 0.36;
const SPACING_EXPLODED = 1.08;
const CAMERA_DISTANCE = 15;
const SPIN_PER_SECOND = 0.22;
const SPIN_WHILE_HOVERING = 0.04;
const POINTER_TILT = 0.12;
const PACKETS_PER_CONNECTOR = 2;
const DRAG_TURN_PER_PIXEL = 0.008;
const DRAG_CLICK_TOLERANCE_PX = 5;
const MAX_PIXEL_RATIO = 1.5;

/**
 * The layered "system" beside the page: one plate per skill layer (top to bottom in the same order
 * as the list in #stack), each carrying a small model of what lives in that layer, joined by corner
 * rails that carry light pulses once the stack is pulled apart.
 *
 * main.js owns `pose`. Scroll-scrubbed values tell the story: spread, focus, turn, tilt, screenX/Y and
 * dim for the skills section, `away` (0 to 1) for leaving it and `arrive` (0 to 1) for reaching the
 * contact section. Time-based values (visibility, scale, assemble) play the page-load intro, and
 * zoom follows the controls. This module draws the blend and handles the pointer: hover, drag to
 * turn, click a layer, double-click and pinch (or Ctrl + wheel) to zoom.
 *
 * Nothing is drawn while the stack is invisible, so the projects and education sections cost no
 * GPU time at all.
 */
export function createStackScene(canvas, { reducedMotion, onLayerHover, onLayerSelect, onZoomRequest, onZoomToggle }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    console.warn("WebGL is unavailable, the 3D stack is hidden.", error);
    return null;
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const pose = {
    // Scrubbed by the scroll.
    spread: 0,
    focus: -1,
    turn: 0,
    tilt: 0,
    screenX: 0.72,
    screenY: 0.5,
    dim: 1,
    scroll: 0,
    velocity: 0,
    away: 0,
    arrive: 0,
    // Animated over time.
    assemble: 0,
    visibility: 1,
    scale: 1,
    zoom: 1,
    contactX: 0.8,
    contactY: 0.55,
    contactScale: 0.8,
    contactDim: 1,
    // Written by this module every frame: how visible the stack really is, for main.js.
    shown: 1,
    // From the skills list.
    hover: -1,
  };

  const palette = readPalette();
  const white = new Color("#ffffff");
  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 120);
  const stack = new Group();

  // A soft studio room, rendered once into an environment map: it gives the metal plates real
  // reflections for the price of one texture lookup.
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const shared = buildSharedMaterials(palette);
  const layers = buildLayers(palette, shared);
  const connectors = buildConnectors(palette);
  const packets = buildPackets(palette);
  const shadow = buildContactShadow();

  scene.add(new AmbientLight(0xc8d6ff, 0.35));
  const keyLight = new DirectionalLight(0xfff3e0, 1.6);
  keyLight.position.set(5, 10, 7);
  scene.add(keyLight);
  const rimLight = new DirectionalLight(palette.sea, 0.9);
  rimLight.position.set(-6, 3, -6);
  scene.add(rimLight);
  const pointerLight = new PointLight(palette.saffron, 6, 14, 1.8);
  scene.add(pointerLight);

  for (const layer of layers) {
    stack.add(layer.group);
  }
  stack.add(connectors.lines, packets.group, shadow);
  scene.add(stack);

  const raycaster = new Raycaster();
  const pointerNdc = new Vector2(10, 10);
  const pickTargets = layers.map((layer, index) => ({ mesh: layer.plate, index }));
  const pickMeshes = pickTargets.map((target) => target.mesh);

  const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, clientX: 0, clientY: 0, canInteract: false, moved: false };
  const drag = {
    isActive: false,
    isResetting: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    turn: 0,
    tilt: 0,
    velocity: 0,
    moved: 0,
    pressedLayer: -1,
  };
  const hoverAmounts = layers.map(() => 0);
  const flashAmounts = layers.map(() => 0);
  let hoveredLayer = -1;
  let spinAngle = 0;
  let spinSpeed = reducedMotion ? 0 : SPIN_PER_SECOND;
  let clock = 0;
  let lastFrameTime = performance.now();
  let isRunning = false;

  let width = 0;
  let height = 0;

  resize();
  bindPointer();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  return { pose, flashLayer, resetView, warmUp, start };

  /** Compiles every shader and draws one frame, so the first visible frames don't stall. */
  function warmUp() {
    packets.group.visible = true;
    renderer.compile(scene, camera);
    update(0, blendedPose());
    renderer.render(scene, camera);
  }

  /** A short white flash and lift on one layer, to confirm a click. */
  function flashLayer(index) {
    flashAmounts[index] = 1;
  }

  /** Eases the dragged rotation back to the default angle. */
  function resetView() {
    drag.velocity = 0;
    drag.isResetting = true;
  }

  function start() {
    if (isRunning) {
      return;
    }
    isRunning = true;
    lastFrameTime = performance.now();
    requestAnimationFrame(frame);
  }

  function stop() {
    isRunning = false;
  }

  function frame(now) {
    if (!isRunning) {
      return;
    }
    requestAnimationFrame(frame);

    const elapsedSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    const blend = blendedPose();
    pose.shown = blend.visibility;
    if (blend.visibility < 0.01) {
      // Skip the scene but keep presenting an empty frame: a clear costs almost nothing, while a
      // canvas that stops and restarts producing frames makes the compositor stall for ~100 ms.
      renderer.clear();
      setHoveredLayer(-1);
      return;
    }
    update(elapsedSeconds, blend);
    renderer.render(scene, camera);
  }

  function update(elapsedSeconds, blend) {
    clock += elapsedSeconds;
    const velocity = Math.max(-60, Math.min(60, pose.velocity));

    updateSpin(elapsedSeconds, velocity);
    updateDrag();
    updatePick(blend);
    updateLayers(elapsedSeconds, blend);

    stack.rotation.y = -0.65 + blend.turn + spinAngle + drag.turn + pointer.smoothX * POINTER_TILT;
    stack.rotation.x = blend.tilt + drag.tilt + pointer.smoothY * POINTER_TILT * 0.5;
    stack.scale.setScalar(blend.scale * pose.zoom * responsiveScale());

    pointerLight.position.set(pointer.smoothX * 12, -pointer.smoothY * 6 + 3, 5);
    camera.setViewOffset(width, height, -(blend.screenX - 0.5) * width, -(blend.screenY - 0.5) * height, width, height);
  }

  /**
   * Turns the scroll values into one placement. Between the skills and the contact section the stack
   * is "absent": leaving, it folds together, spins, shrinks and drifts up with the page, and only
   * fades in the second half of the move; arriving, it rises from below spread apart and assembles
   * as it settles. Both are scrubbed by the scroll, so they run backwards just as smoothly.
   */
  function blendedPose() {
    const isArriving = pose.arrive > 0.001;
    const absent = isArriving ? 1 - pose.arrive : pose.away;
    const motion = easeInOutCubic(absent);
    const direction = isArriving ? 1 : -1;
    const mix = isArriving ? 1 : 0;
    const keep = 1 - mix;
    const fade = 1 - smoothstep(0.35, 1, absent);
    const spread = isArriving ? 0.9 * motion : pose.spread * (1 - motion);
    return {
      screenX: pose.screenX * keep + pose.contactX * mix,
      screenY: pose.screenY * keep + pose.contactY * mix + direction * 0.4 * motion,
      scale: pose.scale * (keep + pose.contactScale * mix) * (1 - 0.35 * motion),
      spread: Math.min(1, spread + pose.assemble),
      focus: isArriving || absent > 0.5 ? -1 : pose.focus,
      turn: pose.turn * keep - direction * 2.4 * motion,
      tilt: pose.tilt * keep,
      visibility: pose.visibility * pose.dim * (isArriving ? pose.contactDim : 1) * fade,
    };
  }

  /** Turns on its own; slows while a layer is under the cursor and stops while dragging. */
  function updateSpin(elapsedSeconds, velocity) {
    if (reducedMotion) {
      return;
    }
    const targetSpeed = drag.isActive ? 0 : hoveredLayer >= 0 ? SPIN_WHILE_HOVERING : SPIN_PER_SECOND;
    spinSpeed += (targetSpeed - spinSpeed) * Math.min(1, elapsedSeconds * 4);
    spinAngle += spinSpeed * elapsedSeconds + velocity * 0.0005;
    const follow = 1 - Math.exp(-elapsedSeconds * 4);
    pointer.smoothX += (pointer.x - pointer.smoothX) * follow;
    pointer.smoothY += (pointer.y - pointer.smoothY) * follow;
  }

  function updateDrag() {
    if (drag.isActive) {
      return;
    }
    if (drag.isResetting) {
      drag.turn *= 0.88;
      drag.tilt *= 0.88;
      if (Math.abs(drag.turn) < 0.001 && Math.abs(drag.tilt) < 0.001) {
        drag.isResetting = false;
      }
      return;
    }
    drag.turn += drag.velocity;
    drag.velocity *= 0.94;
    drag.tilt *= 0.95;
  }

  function updateLayers(elapsedSeconds, blend) {
    const spacing = SPACING_COLLAPSED + (SPACING_EXPLODED - SPACING_COLLAPSED) * blend.spread;
    const middleIndex = (layers.length - 1) / 2;
    const isFocusing = blend.focus >= 0;
    const litByPointer = hoveredLayer >= 0 ? hoveredLayer : pose.hover;

    layers.forEach((layer, index) => {
      const target = index === litByPointer ? 1 : 0;
      hoverAmounts[index] += (target - hoverAmounts[index]) * Math.min(1, elapsedSeconds * 10);
      flashAmounts[index] = Math.max(0, flashAmounts[index] - elapsedSeconds * 1.6);

      const focusAmount = isFocusing ? Math.max(0, 1 - Math.abs(blend.focus - index)) : 0;
      const lit = Math.max(focusAmount, hoverAmounts[index], flashAmounts[index]);
      const presence = isFocusing ? 0.35 + 0.65 * lit : 1;
      const opacity = presence * blend.visibility;
      const flashLift = Math.sin(flashAmounts[index] * Math.PI) * 0.35;

      // Lift the hovered layer only once there is room; in the assembled stack it would cut into the one above.
      layer.group.position.y = (middleIndex - index) * spacing + hoverAmounts[index] * 0.14 * blend.spread + flashLift;
      layer.plateMaterial.opacity = opacity;
      layer.detailMaterial.opacity = opacity;
      layer.detailMaterial.color.copy(shared.ceramic).lerp(palette.saffron, lit * 0.85);
      layer.detailMaterial.emissive.copy(palette.saffron).multiplyScalar(lit * 0.18);
      layer.ledMaterial.opacity = opacity;
      layer.ledMaterial.color.copy(palette.sea).lerp(palette.saffron, lit);
      layer.line.opacity = (0.35 + 0.55 * lit) * opacity;
      layer.line.color.copy(palette.sea).lerp(palette.saffron, lit).lerp(white, flashAmounts[index] * 0.8);
    });

    const totalHeight = spacing * (layers.length - 1);
    connectors.update(totalHeight);
    connectors.material.opacity = 0.3 * blend.visibility;
    shadow.position.y = -totalHeight / 2 - 0.3;
    shadow.material.opacity = 0.75 * blend.visibility;
    packets.update(totalHeight, clock, blend.spread, blend.visibility, reducedMotion);
  }

  function updatePick(blend) {
    // Raycast only when the pointer has moved: the stack under a still cursor rarely changes.
    if (!pointer.canInteract || drag.isActive || blend.visibility < 0.5) {
      setHoveredLayer(-1);
      return;
    }
    if (!pointer.moved && spinSpeed < 0.01) {
      return;
    }
    pointer.moved = false;
    raycaster.setFromCamera(pointerNdc, camera);
    const [hit] = raycaster.intersectObjects(pickMeshes, false);
    const index = hit ? pickTargets.find((target) => target.mesh === hit.object).index : -1;
    setHoveredLayer(index);
  }

  function setHoveredLayer(index) {
    if (index === hoveredLayer) {
      if (index >= 0) {
        onLayerHover?.(hoveredLayer, pointer.clientX, pointer.clientY);
      }
      return;
    }
    hoveredLayer = index;
    document.body.classList.toggle("is-over-layer", index >= 0);
    onLayerHover?.(hoveredLayer, pointer.clientX, pointer.clientY);
  }

  function bindPointer() {
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    if (finePointer) {
      document.body.classList.add("can-drag");
    }

    window.addEventListener(
      "pointermove",
      (event) => {
        pointer.x = event.clientX / window.innerWidth - 0.5;
        pointer.y = event.clientY / window.innerHeight - 0.5;
        pointer.clientX = event.clientX;
        pointer.clientY = event.clientY;
        pointer.moved = true;
        pointerNdc.set(pointer.x * 2, -pointer.y * 2);
        pointer.canInteract = finePointer && isOverDragArea(event.target);

        if (!drag.isActive) {
          return;
        }
        const deltaX = event.clientX - drag.lastX;
        const deltaY = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY));
        drag.velocity = deltaX * DRAG_TURN_PER_PIXEL;
        drag.turn += drag.velocity;
        drag.tilt = Math.max(-0.35, Math.min(0.35, drag.tilt + deltaY * 0.004));
      },
      { passive: true },
    );

    window.addEventListener("pointerdown", (event) => {
      const isMouseLike = event.pointerType === "mouse" || event.pointerType === "pen";
      if (!isMouseLike || event.button !== 0 || !isOverDragArea(event.target)) {
        return;
      }
      // Remember the layer under the cursor now: while the button is held, hover picking pauses.
      drag.pressedLayer = hoveredLayer;
      drag.isActive = true;
      drag.isResetting = false;
      drag.startX = drag.lastX = event.clientX;
      drag.startY = drag.lastY = event.clientY;
      drag.moved = 0;
      drag.velocity = 0;
      document.body.classList.add("is-dragging");
    });

    window.addEventListener("pointerup", () => {
      if (!drag.isActive) {
        return;
      }
      drag.isActive = false;
      document.body.classList.remove("is-dragging");
      if (drag.moved < DRAG_CLICK_TOLERANCE_PX && drag.pressedLayer >= 0) {
        flashLayer(drag.pressedLayer);
        onLayerSelect?.(drag.pressedLayer);
      }
      drag.pressedLayer = -1;
    });

    window.addEventListener("dblclick", (event) => {
      if (isOverDragArea(event.target) && pose.shown > 0.5) {
        onZoomToggle?.();
      }
    });

    // Trackpad pinch arrives as a wheel event with ctrlKey; only take it over the stack itself.
    window.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey || !isOverDragArea(event.target) || pose.shown < 0.5) {
          return;
        }
        event.preventDefault();
        onZoomRequest?.(Math.exp(-event.deltaY * 0.01));
      },
      { passive: false },
    );
  }

  function responsiveScale() {
    const heightScale = Math.min(1, height / 960);
    if (width < 520) {
      return Math.min(0.52, heightScale);
    }
    if (width < 900) {
      return Math.min(0.8, heightScale);
    }
    return heightScale;
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;

    const elevation = 0.5;
    camera.position.set(0, Math.sin(elevation) * CAMERA_DISTANCE, Math.cos(elevation) * CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Only empty parts of the hero, skills and contact sections turn the stack; text and links stay clickable. */
function isOverDragArea(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("[data-drag-stack]")) && !target.closest("a, button, .panel, h1, h2, p");
}

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name) => new Color(styles.getPropertyValue(name).trim());
  return { sea: read("--sea"), saffron: read("--saffron") };
}

/** Geometries every layer reuses, so the whole stack is built from a handful of buffers. */
function buildSharedMaterials() {
  return {
    ceramic: new Color("#d9e0ea"),
    plateGeometry: new RoundedBoxGeometry(PLATE.width, PLATE.height, PLATE.depth, 3, PLATE.radius),
    plateOutline: new EdgesGeometry(new BoxGeometry(PLATE.width, PLATE.height, PLATE.depth)),
    led: new BoxGeometry(0.12, 0.025, 0.025),
  };
}

function buildLayers(palette, shared) {
  const buildersTopToBottom = [buildInterface, buildServices, buildData, buildIntelligence, buildDelivery];

  return buildersTopToBottom.map((buildDetails) => {
    const group = new Group();
    const plateMaterial = new MeshStandardMaterial({ color: "#1a2438", metalness: 0.7, roughness: 0.3, transparent: true });
    const detailMaterial = new MeshStandardMaterial({ color: shared.ceramic, metalness: 0.05, roughness: 0.55, transparent: true, emissive: "#000000" });
    const ledMaterial = new MeshBasicMaterial({ color: palette.sea, transparent: true });
    const line = new LineBasicMaterial({ color: palette.sea, transparent: true, depthWrite: false });

    const plate = new Mesh(shared.plateGeometry, plateMaterial);
    const outline = new LineSegments(shared.plateOutline, line);
    group.add(plate, outline);

    const layer = { group, plate, plateMaterial, detailMaterial, ledMaterial, line, shared };
    buildDetails(layer);
    return layer;
  });
}

function addPart(layer, geometry, [x, y, z], material = layer.detailMaterial) {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  layer.group.add(mesh);
  return mesh;
}

function addLines(layer, points) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points.flat(), 3));
  layer.group.add(new LineSegments(geometry, layer.line));
}

/** Interface: three app windows, each with a title bar and a few content blocks. */
function buildInterface(layer) {
  const windows = [
    { x: -1.0, z: 0.05, width: 1.15, depth: 1.5 },
    { x: 0.35, z: -0.35, width: 1.2, depth: 0.85 },
    { x: 0.35, z: 0.62, width: 1.2, depth: 0.5 },
    { x: 1.3, z: 0.1, width: 0.55, depth: 1.4 },
  ];
  const slab = new RoundedBoxGeometry(1, 0.05, 1, 2, 0.02);
  const bar = new BoxGeometry(1, 0.02, 0.07);
  const block = new RoundedBoxGeometry(1, 0.03, 1, 1, 0.01);

  for (const { x, z, width, depth } of windows) {
    addPart(layer, slab, [x, ON_PLATE + 0.025, z]).scale.set(width, 1, depth);
    const titleBar = addPart(layer, bar, [x, ON_PLATE + 0.06, z - depth / 2 + 0.1], layer.ledMaterial);
    titleBar.scale.set(width - 0.12, 1, 1);
    const content = addPart(layer, block, [x - width * 0.12, ON_PLATE + 0.065, z + 0.08]);
    content.scale.set(width * 0.6, 1, Math.max(0.12, depth - 0.45));
  }
}

/** Services: a rack of small servers with status lights, wired together. */
function buildServices(layer) {
  const size = 0.44;
  const columns = [-1.0, 0, 1.0];
  const rows = [-0.5, 0.5];
  const y = ON_PLATE + size / 2;
  const server = new RoundedBoxGeometry(size, size, size, 3, 0.06);
  const links = [];

  for (const x of columns) {
    for (const z of rows) {
      addPart(layer, server, [x, y, z]);
      addPart(layer, layer.shared.led, [x - 0.08, y + 0.1, z + size / 2 + 0.005], layer.ledMaterial);
    }
  }
  for (const z of rows) {
    links.push([columns[0] + size / 2, y, z], [columns[1] - size / 2, y, z]);
    links.push([columns[1] + size / 2, y, z], [columns[2] - size / 2, y, z]);
  }
  links.push([columns[1], y, rows[0] + size / 2], [columns[1], y, rows[1] - size / 2]);
  addLines(layer, links);
}

/** Data: three databases, each drawn as the usual stack of discs. */
function buildData(layer) {
  const disc = new CylinderGeometry(0.34, 0.34, 0.13, 40);
  for (const [x, z] of [[-0.95, -0.2], [0, 0.3], [0.95, -0.2]]) {
    for (let level = 0; level < 3; level += 1) {
      addPart(layer, disc, [x, ON_PLATE + 0.075 + level * 0.16, z]);
    }
  }
}

/** Intelligence: one model in the middle, fed by smaller nodes around it. */
function buildIntelligence(layer) {
  const core = new IcosahedronGeometry(0.42, 0);
  const node = new SphereGeometry(0.11, 20, 16);
  const centre = [0, ON_PLATE + 0.5, 0];
  addPart(layer, core, centre);
  const satellites = [[-1.15, 0.45], [1.15, -0.45], [-0.9, -0.7], [0.95, 0.7]];
  const links = [];
  for (const [x, z] of satellites) {
    const position = [x, ON_PLATE + 0.13, z];
    addPart(layer, node, position, layer.ledMaterial);
    links.push(position, centre);
  }
  addLines(layer, links);
}

/** Delivery: shipping containers, stacked the way a release ships. */
function buildDelivery(layer) {
  const container = { width: 0.82, height: 0.3, depth: 0.36 };
  const box = new RoundedBoxGeometry(container.width, container.height, container.depth, 2, 0.03);
  const slots = [
    [-1.05, 0, -0.45], [-0.15, 0, -0.45], [0.75, 0, -0.45],
    [-1.05, 0, 0.05], [-0.15, 0, 0.05],
    [-0.6, 1, -0.45], [0.3, 1, -0.45],
  ];

  for (const [x, level, z] of slots) {
    const y = ON_PLATE + container.height / 2 + level * container.height;
    addPart(layer, box, [x, y, z]);
  }
}

const CORNERS = (() => {
  const insetX = PLATE.width / 2 - 0.12;
  const insetZ = PLATE.depth / 2 - 0.12;
  return [[-insetX, -insetZ], [insetX, -insetZ], [-insetX, insetZ], [insetX, insetZ]];
})();

function buildConnectors(palette) {
  const geometry = new BufferGeometry();
  const material = new LineBasicMaterial({ color: palette.sea, transparent: true, opacity: 0.3, depthWrite: false });

  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(CORNERS.length * 6), 3));
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  let lastHeight = -1;

  function update(totalHeight) {
    if (Math.abs(totalHeight - lastHeight) < 1e-4) {
      return;
    }
    lastHeight = totalHeight;
    const attribute = geometry.getAttribute("position");
    CORNERS.forEach(([x, z], index) => {
      attribute.setXYZ(index * 2, x, totalHeight / 2, z);
      attribute.setXYZ(index * 2 + 1, x, -totalHeight / 2, z);
    });
    attribute.needsUpdate = true;
  }

  return { lines, material, update };
}

/** Small light pulses that run up and down the corner rails once the layers have room. */
function buildPackets(palette) {
  const group = new Group();
  const geometry = new SphereGeometry(0.045, 12, 10);
  const items = [];

  CORNERS.forEach(([x, z], cornerIndex) => {
    for (let slot = 0; slot < PACKETS_PER_CONNECTOR; slot += 1) {
      const isWarm = (cornerIndex + slot) % 3 === 0;
      const material = new MeshBasicMaterial({ color: isWarm ? palette.saffron : palette.sea, transparent: true, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, 0, z);
      group.add(mesh);
      items.push({ mesh, phase: (cornerIndex * 0.37 + slot * 0.5) % 1, direction: slot % 2 === 0 ? 1 : -1, speed: 0.18 + cornerIndex * 0.03 });
    }
  });

  function update(totalHeight, clock, spread, visibility, isStatic) {
    const strength = Math.max(0, Math.min(1, (spread - 0.15) / 0.35)) * visibility;
    group.visible = strength > 0.01 && !isStatic;
    if (!group.visible) {
      return;
    }
    for (const item of items) {
      const progress = (((item.phase + clock * item.speed * item.direction) % 1) + 1) % 1;
      item.mesh.position.y = (progress - 0.5) * totalHeight;
      item.mesh.material.opacity = strength * Math.sin(progress * Math.PI);
    }
  }

  return { group, update };
}

/** A soft dark patch under the stack that grounds it, instead of a glow. */
function buildContactShadow() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.7)");
  gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.25)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const material = new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false });
  const plane = new Mesh(new PlaneGeometry(6, 4.6), material);
  plane.rotation.x = -Math.PI / 2;
  return plane;
}
