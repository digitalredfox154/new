import "./styles.css";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { initLeadCapture } from "./production.js";

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const canvas = document.querySelector(".webgl");
const story = document.querySelector(".story");
const scrollCue = document.querySelector(".scroll-cue");
const stageNumber = document.querySelector(".stage-index__current");
const stageLabel = document.querySelector(".stage-index__label");
const motionControl = document.querySelector(".motion-control");
const fallback = document.querySelector(".webgl-fallback");
const dialog = document.querySelector(".lead-dialog");
const leadForm = document.querySelector(".lead-form");
const fullMotion = root.dataset.motion === "full";
const forceTestFallback = window.__SAMAI_TEST_TRANSPORT === true
  && new URLSearchParams(window.location.search).get("fallback") === "1";

const copy = {
  hero: document.querySelector(".copy--hero"),
  criteria: document.querySelector(".copy--criteria"),
  custom: document.querySelector(".copy--custom"),
  handoff: document.querySelector(".copy--handoff"),
  replace: document.querySelector(".copy--replace"),
  replaceReasons: document.querySelector(".copy--replace-reasons"),
  proof: document.querySelector(".copy--proof"),
  pilot: document.querySelector(".copy--pilot"),
};

const hud = {
  criteria: [...document.querySelectorAll('[data-hud="criteria"]')],
  criteriaScore: document.querySelector('[data-hud-score="criteria"]'),
  custom: [...document.querySelectorAll('[data-hud="custom"]')],
  customScore: document.querySelector('[data-hud-score="custom"]'),
  lead: document.querySelector("[data-hud-lead]"),
  transfer: document.querySelector("[data-hud-transfer]"),
  protocol: document.querySelector("[data-hud-protocol]"),
  protocolSteps: [...document.querySelectorAll("[data-protocol-step]")],
  replace: [...document.querySelectorAll('[data-hud="replace"]')],
  case: document.querySelector("[data-hud-case]"),
  caseRoom: document.querySelector("[data-hud-case-room]"),
  pilotScore: document.querySelector('[data-hud-score="pilot"]'),
};

const state = { progress: 0, targetProgress: 0 };
let paused = false;
let ready = false;
let frameHandle = 0;
let textureDensity = 1;
let textureAnisotropy = 1;
let activeChapter = -1;
const seenChapters = new Set();

const eventBuffer = Array.isArray(window.SAMAI_EVENTS) ? window.SAMAI_EVENTS : [];
window.SAMAI_EVENTS = eventBuffer;
const emitEvent = (name, detail = {}) => {
  const payload = { name, ...detail, timestamp: Date.now() };
  eventBuffer.push(payload);
  window.dispatchEvent(new CustomEvent("samai:event", { detail: payload }));
};

const checkpoints = [0, 0.21, 0.395, 0.555, 0.665, 0.735, 0.825, 0.905, 0.975, 1];

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (from, to, amount) => from + (to - from) * amount;
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const envelope = (value, enterStart, enterEnd, exitStart, exitEnd) =>
  smooth(enterStart, enterEnd, value) * (1 - smooth(exitStart, exitEnd, value));

const setCopy = (element, opacity, y = 0, scale = 1) => {
  element.style.opacity = String(opacity);
  element.style.visibility = opacity < 0.012 ? "hidden" : "visible";
  element.style.setProperty("--copy-y", `${y}px`);
  element.style.setProperty("--copy-scale", String(scale));
};

const setHudElement = (element, opacity, y = 0, scale = 1) => {
  element.style.opacity = String(opacity);
  element.style.visibility = opacity < 0.012 ? "hidden" : "visible";
  element.style.setProperty("--hud-y", `${y}px`);
  element.style.setProperty("--hud-scale", String(scale));
};

const updateStoryUi = (progress, viewportMobile) => {
  const scoreVisibility = envelope(progress, 0.36, 0.395, 0.47, 0.515);
  const customScoreVisibility = envelope(progress, 0.5, 0.55, 0.6, 0.66);
  const handoffVisibility = envelope(progress, 0.61, 0.66, 0.68, 0.708);
  const handoffEnter = smooth(0.61, 0.67, progress);
  const protocolVisibility = envelope(progress, 0.69, 0.715, 0.755, 0.78);
  const protocolEnter = smooth(0.69, 0.72, progress);
  const caseVisibility = envelope(progress, 0.86, 0.89, 0.925, 0.952);
  const caseEnter = smooth(0.86, 0.895, progress);
  const pilotVisibility = smooth(0.94, 0.975, progress);

  hud.criteria.forEach((card, index) => {
    const enter = smooth(0.295 + index * 0.012, 0.345 + index * 0.012, progress);
    const visibility = enter * (1 - smooth(0.465, 0.515, progress));
    const direction = index < 2 ? -1 : 1;
    setHudElement(card, visibility, direction * 18 * (1 - enter), mix(0.955, 1, enter));
  });
  setHudElement(hud.criteriaScore, scoreVisibility, 12 * (1 - scoreVisibility), mix(0.94, 1, scoreVisibility));

  hud.custom.forEach((card, index) => {
    const enter = smooth(0.475 + index * 0.012, 0.515 + index * 0.012, progress);
    const visibility = enter * (1 - smooth(0.6, 0.66, progress));
    setHudElement(card, visibility, (index < 2 ? -16 : 16) * (1 - enter), mix(0.955, 1, enter));
  });
  setHudElement(hud.customScore, customScoreVisibility, 12 * (1 - customScoreVisibility), mix(0.94, 1, customScoreVisibility));

  setHudElement(hud.lead, handoffVisibility, 22 * (1 - handoffEnter), mix(0.955, 1, handoffEnter));
  hud.transfer.style.opacity = String(handoffVisibility * 0.82);
  hud.transfer.style.visibility = handoffVisibility < 0.012 ? "hidden" : "visible";
  hud.transfer.style.setProperty("--transfer-scale", String(mix(0.35, 1, handoffEnter)));

  setHudElement(hud.protocol, protocolVisibility, 18 * (1 - protocolEnter), mix(0.965, 1, protocolEnter));
  hud.protocolSteps.forEach((step, index) => {
    const enter = smooth(0.695 + index * 0.007, 0.718 + index * 0.007, progress);
    step.style.opacity = String(enter);
    step.style.transform = `translate3d(${14 * (1 - enter)}px, 0, 0)`;
  });

  hud.replace.forEach((card, index) => {
    const enter = smooth(0.78 + index * 0.006, 0.805 + index * 0.006, progress);
    const visibility = enter * (1 - smooth(0.855, 0.89, progress));
    setHudElement(card, visibility, (index < 2 ? -15 : 15) * (1 - enter), mix(0.955, 1, enter));
  });
  setHudElement(hud.case, caseVisibility, 20 * (1 - caseEnter), mix(0.96, 1, caseEnter));
  hud.case.style.setProperty("--hud-x", `${(viewportMobile ? 18 : 34) * (1 - caseEnter)}px`);
  const roomEnter = smooth(0.875, 0.91, progress);
  hud.caseRoom.style.opacity = String(caseVisibility * roomEnter);
  hud.caseRoom.style.transform = `translate3d(${26 * (1 - roomEnter)}px, 0, 0)`;
  setHudElement(hud.pilotScore, pilotVisibility, 14 * (1 - pilotVisibility), mix(0.94, 1, pilotVisibility));

  const heroVisibility = 1 - smooth(0.075, 0.15, progress);
  const criteriaCopyVisibility = envelope(progress, 0.285, 0.325, 0.4, 0.455);
  const customCopyVisibility = envelope(progress, 0.455, 0.49, 0.565, 0.595);
  const handoffCopyVisibility = envelope(progress, 0.595, 0.63, 0.68, 0.715);
  const replaceCopyVisibility = viewportMobile
    ? envelope(progress, 0.715, 0.745, 0.758, 0.79)
    : envelope(progress, 0.715, 0.745, 0.83, 0.86);
  const replaceReasonsCopyVisibility = viewportMobile ? envelope(progress, 0.77, 0.795, 0.83, 0.86) : 0;
  const proofCopyVisibility = envelope(progress, 0.855, 0.885, 0.92, 0.948);
  const pilotCopyVisibility = smooth(0.94, 0.975, progress);
  setCopy(copy.hero, heroVisibility, -14 * (1 - heroVisibility), mix(1, 0.96, 1 - heroVisibility));
  setCopy(copy.criteria, criteriaCopyVisibility, 10 * (1 - criteriaCopyVisibility), mix(0.97, 1, criteriaCopyVisibility));
  setCopy(copy.custom, customCopyVisibility, 10 * (1 - customCopyVisibility), mix(0.97, 1, customCopyVisibility));
  setCopy(copy.handoff, handoffCopyVisibility, 10 * (1 - handoffCopyVisibility), mix(0.97, 1, handoffCopyVisibility));
  setCopy(copy.replace, replaceCopyVisibility, 10 * (1 - replaceCopyVisibility), mix(0.97, 1, replaceCopyVisibility));
  setCopy(copy.replaceReasons, replaceReasonsCopyVisibility, 10 * (1 - replaceReasonsCopyVisibility), mix(0.97, 1, replaceReasonsCopyVisibility));
  setCopy(copy.proof, proofCopyVisibility, 10 * (1 - proofCopyVisibility), mix(0.97, 1, proofCopyVisibility));
  setCopy(copy.pilot, pilotCopyVisibility, 12 * (1 - pilotCopyVisibility), mix(0.965, 1, pilotCopyVisibility));
  scrollCue.style.opacity = String(1 - smooth(0.02, 0.08, progress));

  const chapterIndex = progress < 0.12 ? 0 : progress < 0.29 ? 1 : progress < 0.455 ? 2 : progress < 0.595 ? 3 : progress < 0.715 ? 4 : progress < 0.86 ? 5 : progress < 0.945 ? 6 : 7;
  const chapterNames = ["ВВОДНАЯ", "ОТБОР", "БАЗОВЫЕ КРИТЕРИИ", "ВАШИ КРИТЕРИИ", "КАРТОЧКА ЛИДА", "ПРАВИЛА РАБОТЫ", "РЕЗУЛЬТАТ", "ТЕСТ"];
  const chapter = String(chapterIndex + 1).padStart(2, "0");
  if (activeChapter !== chapterIndex) {
    activeChapter = chapterIndex;
    stageNumber.textContent = chapter;
    stageLabel.textContent = chapterNames[chapterIndex];
    if (!seenChapters.has(chapterIndex)) {
      seenChapters.add(chapterIndex);
      emitEvent("story_stage_view", { stage: chapterIndex + 1, label: chapterNames[chapterIndex] });
    }
  }
};

const roundedRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
};

const createTexture = ({ width = 1024, height = 512, draw }) => {
  const surface = document.createElement("canvas");
  surface.width = Math.round(width * textureDensity);
  surface.height = Math.round(height * textureDensity);
  const context = surface.getContext("2d");
  context.setTransform(textureDensity, 0, 0, textureDensity, 0, 0);
  context.clearRect(0, 0, width, height);
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = textureAnisotropy;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const drawPanelBase = (ctx, width, height, radius = 24) => {
  roundedRect(ctx, 3, 3, width - 6, height - 6, radius);
  const fill = ctx.createLinearGradient(0, 0, width, height);
  fill.addColorStop(0, "rgba(15,17,12,.98)");
  fill.addColorStop(.55, "rgba(7,9,6,.98)");
  fill.addColorStop(1, "rgba(12,15,9,.98)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(235,241,224,.25)";
  ctx.lineWidth = 3;
  ctx.stroke();
};

const createOrderTexture = () => createTexture({
  width: 1536,
  height: 600,
  draw: (ctx, width) => {
    drawPanelBase(ctx, width, 600, 22);
    ctx.fillStyle = "#bfff52";
    ctx.font = "700 28px Arial";
    ctx.letterSpacing = "7px";
    ctx.fillText("01 / ОТБОР", 76, 88);
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "500 92px Arial";
    ctx.letterSpacing = "-5px";
    ctx.fillText("Оставляем тех,", 74, 265);
    ctx.fillText("кто подходит.", 74, 380);
    ctx.fillStyle = "rgba(201,204,194,.62)";
    ctx.font = "600 24px Arial";
    ctx.letterSpacing = "3px";
    ctx.fillText("ПО УСЛОВИЯМ, КОТОРЫЕ ЗАДАЛИ ВЫ", 78, 515);
    ctx.strokeStyle = "rgba(191,255,82,.68)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(width - 250, 82);
    ctx.lineTo(width - 80, 82);
    ctx.stroke();
  },
});

const createCriterionTexture = ({ index, label, main, note }) => createTexture({
  width: 1024,
  height: 512,
  draw: (ctx, width, height) => {
    drawPanelBase(ctx, width, height);
    ctx.fillStyle = "rgba(191,255,82,.65)";
    ctx.font = "500 72px Arial";
    ctx.fillText(index, width - 138, 105);
    ctx.fillStyle = "rgba(201,204,194,.62)";
    ctx.font = "700 24px Arial";
    ctx.letterSpacing = "5px";
    ctx.fillText(label.toUpperCase(), 56, 84);
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "600 58px Arial";
    ctx.letterSpacing = "-2px";
    ctx.fillText(main, 54, 244);
    ctx.fillStyle = "rgba(220,255,155,.82)";
    ctx.font = "700 25px Arial";
    ctx.letterSpacing = "4px";
    ctx.fillText(note.toUpperCase(), 56, 420);
    ctx.strokeStyle = "rgba(191,255,82,.34)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(56, 336);
    ctx.lineTo(width - 56, 336);
    ctx.stroke();
  },
});

const createScoreTexture = () => createTexture({
  width: 960,
  height: 640,
  draw: (ctx, width) => {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(201,204,194,.48)";
    ctx.font = "700 23px Arial";
    ctx.letterSpacing = "7px";
    ctx.fillText("БАЗОВАЯ ПРОВЕРКА", width / 2, 92);
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "400 220px Arial";
    ctx.letterSpacing = "-18px";
    ctx.fillText("4/4", width / 2, 338);
    ctx.fillStyle = "#c9ccc2";
    ctx.font = "700 26px Arial";
    ctx.letterSpacing = "7px";
    ctx.fillText("ПО БАЗОВЫМ КРИТЕРИЯМ", width / 2, 512);
    ctx.fillStyle = "#bfff52";
    ctx.fillRect(width / 2 - 64, 555, 128, 4);
  },
});

const createChipTexture = ({ index, label, value }) => createTexture({
  width: 900,
  height: 320,
  draw: (ctx, width, height) => {
    drawPanelBase(ctx, width, height, 22);
    ctx.fillStyle = "rgba(191,255,82,.62)";
    ctx.font = "500 46px Arial";
    ctx.fillText(index, width - 104, 74);
    ctx.fillStyle = "rgba(201,204,194,.58)";
    ctx.font = "700 20px Arial";
    ctx.letterSpacing = "4px";
    ctx.fillText(label.toUpperCase(), 42, 64);
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "600 48px Arial";
    ctx.letterSpacing = "-1px";
    ctx.fillText(value, 42, 196);
    ctx.fillStyle = "#bfff52";
    ctx.fillRect(42, 252, 86, 3);
  },
});

const createCustomScoreTexture = () => createTexture({
  width: 960,
  height: 640,
  draw: (ctx, width) => {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(201,204,194,.52)";
    ctx.font = "700 22px Arial";
    ctx.letterSpacing = "7px";
    ctx.fillText("НАСТРОЙКА", width / 2, 108);
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "500 112px Arial";
    ctx.letterSpacing = "-6px";
    ctx.fillText("ВАШИ", width / 2, 306);
    ctx.fillStyle = "#c9ccc2";
    ctx.font = "500 68px Arial";
    ctx.letterSpacing = "-3px";
    ctx.fillText("КРИТЕРИИ", width / 2, 404);
    ctx.fillStyle = "#bfff52";
    ctx.fillRect(width / 2 - 58, 490, 116, 4);
  },
});

const createLeadTexture = () => createTexture({
  width: 1280,
  height: 820,
  draw: (ctx, width, height) => {
    drawPanelBase(ctx, width, height, 28);
    ctx.fillStyle = "#bfff52";
    ctx.font = "700 22px Arial";
    ctx.letterSpacing = "6px";
    ctx.fillText("ДЕМО-КАРТОЧКА", 66, 76);
    ctx.fillStyle = "rgba(201,204,194,.58)";
    ctx.textAlign = "right";
    ctx.font = "600 22px Arial";
    ctx.fillText("ЛИД #024", width - 66, 76);
    ctx.textAlign = "left";
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "500 62px Arial";
    ctx.letterSpacing = "-4px";
    ctx.fillText("Квалифицированный лид", 64, 192);
    const rows = [
      ["ГЕОГРАФИЯ", "Москва"],
      ["БЮДЖЕТ", "12,4 млн ₽"],
      ["СРОК ПОКУПКИ", "до 3 месяцев"],
      ["ГОТОВНОСТЬ", "подтверждена"],
    ];
    rows.forEach(([label, value], index) => {
      const y = 318 + index * 98;
      ctx.fillStyle = "rgba(201,204,194,.46)";
      ctx.font = "700 20px Arial";
      ctx.letterSpacing = "4px";
      ctx.fillText(label, 66, y);
      ctx.fillStyle = index === 3 ? "#dcff9b" : "#f3f3ed";
      ctx.font = "600 34px Arial";
      ctx.letterSpacing = "-1px";
      ctx.textAlign = "right";
      ctx.fillText(value, width - 66, y);
      ctx.textAlign = "left";
      ctx.strokeStyle = "rgba(239,243,229,.1)";
      ctx.beginPath();
      ctx.moveTo(66, y + 30);
      ctx.lineTo(width - 66, y + 30);
      ctx.stroke();
    });
    ctx.fillStyle = "#bfff52";
    ctx.font = "700 22px Arial";
    ctx.letterSpacing = "5px";
    ctx.fillText("ПЕРЕДАНО В ПРОДАЖИ", 66, height - 55);
  },
});

const createReplacementTexture = ({ index, title }) => createTexture({
  width: 900,
  height: 330,
  draw: (ctx, width, height) => {
    drawPanelBase(ctx, width, height, 22);
    ctx.fillStyle = "rgba(201,204,194,.45)";
    ctx.font = "600 21px Arial";
    ctx.letterSpacing = "5px";
    ctx.fillText(`0${index} / ОСНОВАНИЕ`, 42, 62);
    ctx.fillStyle = "#f3f3ed";
    const titleSize = title.length > 25 ? 32 : title.length > 18 ? 38 : 47;
    ctx.font = `600 ${titleSize}px Arial`;
    ctx.letterSpacing = "-2px";
    ctx.fillText(title, 42, 188);
    ctx.fillStyle = "#bfff52";
    ctx.font = "700 20px Arial";
    ctx.letterSpacing = "5px";
    ctx.fillText("НА ЗАМЕНУ", 42, height - 42);
    ctx.textAlign = "right";
    ctx.font = "500 58px Arial";
    ctx.fillText("↺", width - 46, height - 38);
  },
});

const createPilotTexture = () => createTexture({
  width: 960,
  height: 720,
  draw: (ctx, width) => {
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(201,204,194,.5)";
    ctx.font = "700 22px Arial";
    ctx.letterSpacing = "8px";
    ctx.fillText("ТЕСТ", width / 2, 86);
    ctx.fillStyle = "#f3f3ed";
    ctx.font = "400 280px Arial";
    ctx.letterSpacing = "-22px";
    ctx.fillText("10", width / 2, 386);
    ctx.fillStyle = "#c9ccc2";
    ctx.font = "700 25px Arial";
    ctx.letterSpacing = "6px";
    ctx.fillText("КВАЛИФИЦИРОВАННЫХ ЛИДОВ", width / 2, 510);
    ctx.fillStyle = "#bfff52";
    ctx.fillRect(width / 2 - 70, 566, 140, 4);
    ctx.fillStyle = "rgba(220,255,155,.82)";
    ctx.font = "700 21px Arial";
    ctx.letterSpacing = "6px";
    ctx.fillText("ПО ВАШИМ КРИТЕРИЯМ", width / 2, 640);
  },
});

const makePanel = ({ width, height, texture, depth = 0.14 }) => {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0a0c08,
    metalness: 0.92,
    roughness: 0.23,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
    envMapIntensity: 1.5,
    transparent: true,
    opacity: 0,
  });
  const body = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 5, 0.07), bodyMaterial);
  const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.08, height - 0.08), faceMaterial);
  face.position.z = depth / 2 + 0.006;
  group.add(body, face);
  group.userData.materials = [bodyMaterial, faceMaterial];
  group.visible = false;
  return group;
};

const makePlane = ({ width, height, texture }) => {
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  plane.userData.material = material;
  plane.visible = false;
  return plane;
};

const setPanelOpacity = (group, opacity) => {
  group.userData.materials[0].opacity = opacity * 0.96;
  group.userData.materials[1].opacity = opacity;
  group.visible = opacity > 0.002;
};

const setPlaneOpacity = (plane, opacity) => {
  plane.userData.material.opacity = opacity;
  plane.visible = opacity > 0.002;
};

const startFallback = () => {
  fallback.hidden = false;
  fallback.querySelector("p")?.setAttribute("hidden", "");
  root.classList.add("webgl-fallback-active");
  root.classList.add("is-ready");
  canvas.hidden = true;

  let viewportMobile = window.innerWidth < 800;
  let storyStart = story.offsetTop;
  let storyDistance = Math.max(1, story.offsetHeight - window.innerHeight);

  const renderFallback = () => {
    const progress = fullMotion ? clamp((window.scrollY - storyStart) / storyDistance) : 0;
    state.progress = progress;
    state.targetProgress = progress;
    updateStoryUi(progress, viewportMobile);
    fallback.style.setProperty("--fallback-turn", `${progress * 220}deg`);
    fallback.style.setProperty("--fallback-scale", String(mix(0.82, 1.08, smooth(0.08, 1, progress))));
  };

  const measureFallback = () => {
    viewportMobile = window.innerWidth < 800;
    storyStart = story.offsetTop;
    storyDistance = Math.max(1, story.offsetHeight - window.innerHeight);
    renderFallback();
  };

  window.addEventListener("scroll", renderFallback, { passive: true });
  window.addEventListener("resize", measureFallback, { passive: true });
  window.addEventListener("load", measureFallback, { once: true });
  document.fonts?.ready.then(measureFallback);
  measureFallback();
};

const initScene = () => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: window.innerWidth > 800,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.01;
  textureDensity = window.innerWidth < 800 ? 1.25 : 1.5;
  textureAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050604);
  scene.fog = new THREE.FogExp2(0x050604, 0.058);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  const cameraRig = new THREE.Group();
  cameraRig.add(camera);
  scene.add(cameraRig);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const envMap = pmrem.fromScene(roomEnvironment, 0.035).texture;
  scene.environment = envMap;
  roomEnvironment.dispose();
  pmrem.dispose();

  const keyLight = new THREE.SpotLight(0xf4f6ed, 118, 30, Math.PI * 0.22, 0.78, 1.2);
  keyLight.position.set(-4.8, 6.2, 8.5);
  keyLight.target.position.set(0, 0, 0);
  scene.add(keyLight, keyLight.target);

  const rimLight = new THREE.PointLight(0xbfff52, 32, 18, 1.7);
  rimLight.position.set(4.1, -1.2, 4.8);
  scene.add(rimLight);

  const softLight = new THREE.PointLight(0xc9d0bd, 11, 20, 2);
  softLight.position.set(-5, -3, 1.2);
  scene.add(softLight);

  const engine = new THREE.Group();
  scene.add(engine);

  const blackTitanium = new THREE.MeshPhysicalMaterial({
    color: 0x090b08,
    metalness: 0.98,
    roughness: 0.18,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.85,
  });
  const brushedMetal = new THREE.MeshPhysicalMaterial({
    color: 0x454a40,
    metalness: 0.96,
    roughness: 0.27,
    clearcoat: 0.82,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1.65,
  });
  const limeMetal = new THREE.MeshPhysicalMaterial({
    color: 0x536d17,
    emissive: 0xbfff52,
    emissiveIntensity: 0.26,
    metalness: 0.84,
    roughness: 0.22,
    transparent: true,
    opacity: 0.72,
    envMapIntensity: 1.5,
  });

  const baseDisk = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.7, 0.2, 128, 1, false), blackTitanium);
  baseDisk.rotation.x = Math.PI / 2;
  baseDisk.position.z = -0.16;
  engine.add(baseDisk);

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.78, 0.16, 32, 192), blackTitanium);
  const middleRing = new THREE.Mesh(new THREE.TorusGeometry(2.16, 0.095, 24, 160), brushedMetal);
  middleRing.rotation.x = Math.PI * 0.64;
  middleRing.rotation.y = Math.PI * 0.14;
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.08, 24, 144), limeMetal);
  innerRing.rotation.x = Math.PI * 0.5;
  innerRing.rotation.y = Math.PI * 0.17;
  engine.add(outerRing, middleRing, innerRing);

  const lensMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x758369,
    metalness: 0.08,
    roughness: 0.1,
    transmission: 0.91,
    thickness: 1.3,
    ior: 1.44,
    transparent: true,
    opacity: 0.72,
    envMapIntensity: 1.45,
  });
  const lens = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 64), lensMaterial);
  lens.scale.z = 0.34;
  lens.position.z = 0.18;
  engine.add(lens);

  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x18200f,
    emissive: 0x5c791c,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.62,
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.52, 48, 48), coreMaterial);
  core.scale.z = 0.48;
  core.position.z = 0.3;
  engine.add(core);

  const tickGeometry = new THREE.BoxGeometry(0.026, 0.15, 0.04);
  const tickMaterial = new THREE.MeshStandardMaterial({ color: 0x79806e, metalness: 0.9, roughness: 0.34, vertexColors: true });
  const ticks = new THREE.InstancedMesh(tickGeometry, tickMaterial, 72);
  const dummy = new THREE.Object3D();
  const tickColor = new THREE.Color();
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const radius = index % 6 === 0 ? 3.07 : 3.0;
    dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.02);
    dummy.rotation.z = angle - Math.PI / 2;
    dummy.scale.y = index % 6 === 0 ? 1.7 : 0.75;
    dummy.updateMatrix();
    ticks.setMatrixAt(index, dummy.matrix);
    tickColor.set(index % 6 === 0 ? 0xbfff52 : 0x596052);
    ticks.setColorAt(index, tickColor);
  }
  ticks.instanceMatrix.needsUpdate = true;
  ticks.instanceColor.needsUpdate = true;
  engine.add(ticks);

  const segments = [];
  for (let index = 0; index < 4; index += 1) {
    const material = limeMetal.clone();
    material.opacity = 0;
    const segment = new THREE.Mesh(new THREE.TorusGeometry(3.23, 0.032, 12, 64, Math.PI * 0.44), material);
    segment.rotation.z = index * Math.PI / 2 + 0.1;
    segment.position.z = 0.08;
    segment.userData.baseRotation = segment.rotation.z;
    engine.add(segment);
    segments.push(segment);
  }

  const orderPanel = makePanel({ width: 5.35, height: 2.08, texture: createOrderTexture() });
  scene.add(orderPanel);

  const criteriaData = [
    { index: "01", label: "География", main: "Москва / регионы", note: "условие задано" },
    { index: "02", label: "Бюджет", main: "От 10 / от 6 млн ₽", note: "порог подтверждён" },
    { index: "03", label: "Срок покупки", main: "До 3 месяцев", note: "срок подтверждён" },
    { index: "04", label: "Готовность", main: "Деньги на покупку", note: "подтверждено" },
  ];
  const criteriaPanels = criteriaData.map((item) => {
    const panel = makePanel({ width: 2.72, height: 1.24, texture: createCriterionTexture(item) });
    scene.add(panel);
    return panel;
  });

  const scorePlane = makePlane({ width: 2.5, height: 1.67, texture: createScoreTexture() });
  scene.add(scorePlane);

  const customData = [
    { index: "A", label: "Тип объекта", value: "Ваш сегмент" },
    { index: "B", label: "Район / ЖК", value: "Ваша география" },
    { index: "C", label: "Способ оплаты", value: "Ваши условия" },
    { index: "D", label: "Исключения", value: "Ваш стоп-лист" },
  ];
  const customPanels = customData.map((item) => {
    const panel = makePanel({ width: 2.42, height: 0.94, texture: createChipTexture(item), depth: 0.12 });
    scene.add(panel);
    return panel;
  });
  const customScorePlane = makePlane({ width: 2.35, height: 1.57, texture: createCustomScoreTexture() });
  scene.add(customScorePlane);

  const leadPanel = makePanel({ width: 5.4, height: 3.46, texture: createLeadTexture(), depth: 0.18 });
  scene.add(leadPanel);

  const replacementTitles = [
    "Дубль: контакт был за последние 3 месяца",
    "Не интересует покупка",
    "Уже купил",
    "Недозвон более 5 раз",
  ];
  const replacementPanels = replacementTitles.map((title, index) => {
    const panel = makePanel({ width: 2.62, height: 0.96, texture: createReplacementTexture({ index: index + 1, title }), depth: 0.12 });
    scene.add(panel);
    return panel;
  });

  const pilotPlane = makePlane({ width: 2.9, height: 2.18, texture: createPilotTexture() });
  scene.add(pilotPlane);

  const pathCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-7.5, 1.4, -1.2),
    new THREE.Vector3(-5.4, -0.9, 0.1),
    new THREE.Vector3(-3.2, 0.7, 0.2),
    new THREE.Vector3(-1.6, -0.2, 0.4),
    new THREE.Vector3(0, 0, 0.7),
  ]);
  const pathGlowMaterial = new THREE.MeshBasicMaterial({ color: 0xbfff52, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pathGlow = new THREE.Mesh(new THREE.TubeGeometry(pathCurve, 160, 0.035, 8, false), pathGlowMaterial);
  const pathCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xedffd1, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const pathCore = new THREE.Mesh(new THREE.TubeGeometry(pathCurve, 160, 0.009, 6, false), pathCoreMaterial);
  scene.add(pathGlow, pathCore);

  const particleCount = window.innerWidth < 800 ? 150 : 250;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleColors = new Float32Array(particleCount * 3);
  const starts = [];
  const ordered = [];
  const rings = [];
  const handoffPoints = [];
  const replacementPoints = [];
  const proofPoints = [];
  const pilotPoints = [];
  const accepted = [];
  const warmWhite = new THREE.Color(0xc9ccc2);
  const lime = new THREE.Color(0xbfff52);

  for (let index = 0; index < particleCount; index += 1) {
    const isAccepted = index % 3 === 0;
    accepted.push(isAccepted);
    const start = new THREE.Vector3((Math.random() - 0.5) * 15, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 7 - 1.8);
    const t = (index % Math.ceil(particleCount / 3)) / Math.ceil(particleCount / 3);
    const curvePoint = pathCurve.getPoint(clamp(t));
    const radius = (1 - t) * 0.75 + 0.08;
    const angle = index * 1.73;
    const orderedPoint = isAccepted
      ? curvePoint.clone().add(new THREE.Vector3(0, Math.sin(angle) * radius, Math.cos(angle) * radius))
      : start.clone().multiplyScalar(1.22).add(new THREE.Vector3(0, Math.sign(start.y || 1) * 1.4, -2.4));
    const finalAngle = (index / particleCount) * Math.PI * 10;
    const ringPoint = isAccepted
      ? new THREE.Vector3(Math.cos(finalAngle) * 3.05, Math.sin(finalAngle) * 3.05, -0.2 + Math.sin(index) * 0.25)
      : orderedPoint.clone().multiplyScalar(1.18);
    const row = index % 18;
    const column = Math.floor(index / 18) % 10;
    const handoffPoint = isAccepted
      ? new THREE.Vector3(-4 + row * 0.22, 1.8 - column * 0.36, -0.6 + Math.sin(index) * 0.08)
      : ringPoint;
    const replacementPoint = isAccepted
      ? new THREE.Vector3(2.6 + Math.cos(finalAngle) * 3, Math.sin(finalAngle) * 2.5, -1.1)
      : ringPoint.clone().multiplyScalar(1.12);
    const proofIndex = index % 8;
    const proofLayer = Math.floor(index / 8) % 6;
    const proofAngle = (proofIndex / 8) * Math.PI * 2 + proofLayer * 0.07;
    const proofRadius = 2.05 + proofLayer * 0.2;
    const proofPoint = isAccepted
      ? new THREE.Vector3(3.35 + Math.cos(proofAngle) * proofRadius, Math.sin(proofAngle) * proofRadius * 0.86, -0.25 + proofLayer * 0.025)
      : replacementPoint.clone().multiplyScalar(1.06);
    const pilotAngle = (index / particleCount) * Math.PI * 2;
    const pilotPoint = isAccepted
      ? new THREE.Vector3(Math.cos(pilotAngle) * 2.75, -1 + Math.sin(pilotAngle) * 2.75, -0.2)
      : proofPoint.clone().multiplyScalar(1.08);
    starts.push(start);
    ordered.push(orderedPoint);
    rings.push(ringPoint);
    handoffPoints.push(handoffPoint);
    replacementPoints.push(replacementPoint);
    proofPoints.push(proofPoint);
    pilotPoints.push(pilotPoint);
    particlePositions[index * 3] = start.x;
    particlePositions[index * 3 + 1] = start.y;
    particlePositions[index * 3 + 2] = start.z;
    const color = isAccepted ? lime : warmWhite;
    particleColors[index * 3] = color.r;
    particleColors[index * 3 + 1] = color.g;
    particleColors[index * 3 + 2] = color.b;
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  const particleMaterial = new THREE.PointsMaterial({
    size: window.innerWidth < 800 ? 0.052 : 0.043,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  const starCount = window.innerWidth < 800 ? 80 : 150;
  const starPositions = new Float32Array(starCount * 3);
  for (let index = 0; index < starCount; index += 1) {
    starPositions[index * 3] = (Math.random() - 0.5) * 22;
    starPositions[index * 3 + 1] = (Math.random() - 0.5) * 13;
    starPositions[index * 3 + 2] = -4 - Math.random() * 10;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x7f8577, size: 0.017, transparent: true, opacity: 0.3, depthWrite: false }));
  scene.add(stars);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshPhysicalMaterial({ color: 0x050604, metalness: 0.76, roughness: 0.36, transparent: true, opacity: 0.48, envMapIntensity: 1.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.65;
  floor.position.z = -0.6;
  scene.add(floor);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), window.innerWidth < 800 ? 0.16 : 0.22, 0.5, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let viewportMobile = window.innerWidth < 800;
  let storyStart = story.offsetTop;
  let storyDistance = Math.max(1, story.offsetHeight - window.innerHeight);

  const syncScrollProgress = () => {
    if (!fullMotion) return;
    state.targetProgress = clamp((window.scrollY - storyStart) / storyDistance);
  };

  const measureStory = () => {
    storyStart = story.offsetTop;
    storyDistance = Math.max(1, story.offsetHeight - window.innerHeight);
    syncScrollProgress();
  };

  const resize = () => {
    viewportMobile = window.innerWidth < 800;
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.fov = viewportMobile ? 43 : 36;
    camera.updateProjectionMatrix();
    const pixelRatio = Math.min(window.devicePixelRatio, viewportMobile ? 1.45 : 1.85);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloom.setSize(width, height);
    measureStory();
  };
  resize();
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("scroll", syncScrollProgress, { passive: true });

  const pointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();
  window.addEventListener("pointermove", (event) => {
    pointerTarget.x = event.clientX / window.innerWidth - 0.5;
    pointerTarget.y = event.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  const hiddenPoint = new THREE.Vector3(0, 0, -3);
  const criteriaDesktopTargets = [
    new THREE.Vector3(-3.38, 1.08, 1.15), new THREE.Vector3(3.38, 1.08, 1.15),
    new THREE.Vector3(-3.38, -1.58, 1.15), new THREE.Vector3(3.38, -1.58, 1.15),
  ];
  const criteriaMobileTargets = [
    new THREE.Vector3(-1.03, 1.28, 1.1), new THREE.Vector3(1.03, 1.28, 1.1),
    new THREE.Vector3(-1.03, -1.5, 1.1), new THREE.Vector3(1.03, -1.5, 1.1),
  ];
  const customDesktopTargets = [
    new THREE.Vector3(0.65, 1.65, 1.2), new THREE.Vector3(4.35, 1.38, 1.2),
    new THREE.Vector3(0.65, -1.5, 1.2), new THREE.Vector3(4.35, -1.28, 1.2),
  ];
  const customMobileTargets = [
    new THREE.Vector3(-1.0, .5, 1.2), new THREE.Vector3(1.0, .5, 1.2),
    new THREE.Vector3(-1.0, -1.58, 1.2), new THREE.Vector3(1.0, -1.58, 1.2),
  ];
  const replaceDesktopTargets = [
    new THREE.Vector3(1.0, 1.58, 1.25), new THREE.Vector3(4.45, 1.22, 1.25),
    new THREE.Vector3(1.0, -1.48, 1.25), new THREE.Vector3(4.45, -1.12, 1.25),
  ];
  const replaceMobileTargets = [
    new THREE.Vector3(-1.0, .9, 1.2), new THREE.Vector3(1.0, .9, 1.2),
    new THREE.Vector3(-1.0, -1.25, 1.2), new THREE.Vector3(1.0, -1.25, 1.2),
  ];

  const clock = new THREE.Clock();
  const current = new THREE.Vector3();
  let motionTime = 0;

  const render = () => {
    const delta = Math.min(clock.getDelta(), 0.05);
    if (!paused) motionTime += delta;
    if (fullMotion) {
      const response = viewportMobile ? 12 : 8;
      const smoothing = 1 - Math.exp(-response * delta);
      state.progress = mix(state.progress, state.targetProgress, smoothing);
      if (Math.abs(state.progress - state.targetProgress) < 0.0001) {
        state.progress = state.targetProgress;
      }
    }
    const progress = fullMotion ? state.progress : 0;

    const order = smooth(0.1, 0.29, progress);
    const criteria = smooth(0.27, 0.46, progress);
    const custom = smooth(0.45, 0.6, progress);
    const handoff = smooth(0.59, 0.71, progress);
    const protocolPhase = smooth(0.675, 0.73, progress);
    const replace = smooth(0.75, 0.86, progress);
    const proof = smooth(0.855, 0.925, progress);
    const pilot = smooth(0.93, 0.98, progress);

    pointer.lerp(pointerTarget, paused ? 0 : 0.04);
    cameraRig.rotation.y = pointer.x * 0.034;
    cameraRig.rotation.x = pointer.y * -0.02;

    const depthPhase = Math.max(criteria * (1 - custom), custom * (1 - handoff), handoff * (1 - protocolPhase), protocolPhase * (1 - replace), replace * (1 - proof), proof * (1 - pilot));
    camera.position.z = viewportMobile ? mix(12.8, 11.8, depthPhase) : mix(11.4, 10.45, depthPhase);
    camera.position.y = viewportMobile ? mix(0.12, -0.08, criteria) : mix(0.12, 0.02, criteria);
    camera.position.x = viewportMobile ? 0 : mix(-0.08, 0.14, order);
    camera.lookAt(0, 0, 0);

    let engineX = 0;
    let engineY = viewportMobile ? mix(-1.0, 0.36, criteria) : -0.15;
    let engineScale = viewportMobile ? mix(0.58, 0.47, criteria) : 0.82;
    engineX = mix(engineX, viewportMobile ? 0 : 2.45, custom);
    engineY = mix(engineY, viewportMobile ? 0.28 : -0.1, custom);
    engineScale = mix(engineScale, viewportMobile ? 0.46 : 0.7, custom);
    engineX = mix(engineX, viewportMobile ? 0 : -2.75, handoff);
    engineY = mix(engineY, viewportMobile ? 0.2 : -0.25, handoff);
    engineScale = mix(engineScale, viewportMobile ? 0.45 : 0.58, handoff);
    engineX = mix(engineX, viewportMobile ? 0 : 2.55, protocolPhase);
    engineY = mix(engineY, viewportMobile ? 0.24 : -0.2, protocolPhase);
    engineScale = mix(engineScale, viewportMobile ? 0.44 : 0.6, protocolPhase);
    engineX = mix(engineX, viewportMobile ? 0 : 2.55, replace);
    engineY = mix(engineY, viewportMobile ? 0.2 : -0.2, replace);
    engineScale = mix(engineScale, viewportMobile ? 0.44 : 0.6, replace);
    engineX = mix(engineX, viewportMobile ? 0 : 3.6, proof);
    engineY = mix(engineY, viewportMobile ? 0.14 : -0.12, proof);
    engineScale = mix(engineScale, viewportMobile ? 0.43 : 0.62, proof);
    engineX = mix(engineX, 0, pilot);
    engineY = mix(engineY, viewportMobile ? -1.15 : -1.15, pilot);
    engineScale = mix(engineScale, viewportMobile ? 0.52 : 0.76, pilot);

    engine.position.set(engineX, engineY, 0);
    engine.scale.setScalar(engineScale);
    engine.rotation.y = Math.sin(motionTime * 0.15) * 0.09 + order * 0.1 + handoff * 0.14 - protocolPhase * 0.12 - replace * 0.06 + proof * 0.12 + pilot * 0.04;
    engine.rotation.x = Math.sin(motionTime * 0.24) * 0.02 + order * 0.045;
    outerRing.rotation.z = motionTime * 0.025 + progress * 1.05;
    middleRing.rotation.z = -motionTime * 0.08 - order * 2.1 + custom * 0.7;
    innerRing.rotation.z = motionTime * 0.12 + order * 2.8 - replace * 0.8;
    ticks.rotation.z = -motionTime * 0.018 + criteria * 0.45;
    lens.rotation.z = motionTime * 0.06;
    lensMaterial.opacity = 0.52 + order * 0.22;
    coreMaterial.emissiveIntensity = 0.4 + order * 0.65 + proof * 0.18 + pilot * 0.25 + Math.sin(motionTime * 1.6) * 0.035;
    rimLight.intensity = 25 + order * 20 + proof * 8 + pilot * 12;
    rimLight.position.x = 4.1 - custom * 1.2 + handoff * 0.8;

    const segmentVisibility = smooth(0.27, 0.4, progress) * (1 - smooth(0.92, 0.97, progress));
    segments.forEach((segment, index) => {
      segment.material.opacity = segmentVisibility * 0.76;
      segment.rotation.z = segment.userData.baseRotation + (1 - segmentVisibility) * (index % 2 ? -0.34 : 0.34);
      segment.scale.setScalar(0.88 + segmentVisibility * 0.12);
    });

    const orderVisibility = envelope(progress, 0.14, 0.2, 0.28, 0.34);
    pathGlowMaterial.opacity = orderVisibility * 0.36;
    pathCoreMaterial.opacity = orderVisibility * 0.76;
    const orderScale = mix(0.42, 1, smooth(0.14, 0.22, progress));
    orderPanel.scale.setScalar(orderScale * (viewportMobile ? 0.69 : 1));
    orderPanel.position.z = mix(-0.8, 2.25, smooth(0.14, 0.22, progress)) - smooth(0.29, 0.36, progress) * 4;
    orderPanel.position.y = viewportMobile ? -0.22 : -0.04;
    orderPanel.rotation.x = mix(0.24, 0, smooth(0.14, 0.22, progress));
    setPanelOpacity(orderPanel, orderVisibility);

    const criteriaTargets = viewportMobile ? criteriaMobileTargets : criteriaDesktopTargets;
    criteriaPanels.forEach((panel, index) => {
      const enter = smooth(0.295 + index * 0.012, 0.345 + index * 0.012, progress);
      const visibility = enter * (1 - smooth(0.465, 0.515, progress));
      panel.position.lerpVectors(hiddenPoint, criteriaTargets[index], enter);
      const targetScale = viewportMobile ? 0.5 : 0.85;
      panel.scale.setScalar(Math.max(0.001, enter * targetScale));
      panel.rotation.y = (1 - enter) * (index % 2 ? -1.1 : 1.1);
      panel.rotation.x = (1 - enter) * (index < 2 ? -0.28 : 0.28);
      setPanelOpacity(panel, 0);
    });
    const scoreVisibility = envelope(progress, 0.36, 0.395, 0.47, 0.515);
    scorePlane.position.set(0, viewportMobile ? -0.28 : -0.36, 1.38);
    scorePlane.scale.setScalar((viewportMobile ? 0.58 : 0.86) * mix(0.64, 1, smooth(0.39, 0.44, progress)));
    setPlaneOpacity(scorePlane, 0);

    const customTargets = viewportMobile ? customMobileTargets : customDesktopTargets;
    customPanels.forEach((panel, index) => {
      const enter = smooth(0.475 + index * 0.012, 0.515 + index * 0.012, progress);
      const visibility = enter * (1 - smooth(0.6, 0.66, progress));
      panel.position.lerpVectors(hiddenPoint, customTargets[index], enter);
      panel.scale.setScalar(Math.max(0.001, enter * (viewportMobile ? 0.52 : 0.86)));
      panel.rotation.y = (1 - enter) * (index % 2 ? -1 : 1);
      setPanelOpacity(panel, 0);
    });
    const customScoreVisibility = envelope(progress, 0.5, 0.55, 0.6, 0.66);
    customScorePlane.position.set(viewportMobile ? 0 : 2.48, viewportMobile ? -0.62 : -0.08, 1.38);
    customScorePlane.scale.setScalar(viewportMobile ? 0.54 : 0.76);
    setPlaneOpacity(customScorePlane, 0);

    const handoffVisibility = envelope(progress, 0.61, 0.66, 0.68, 0.708);
    const handoffEnter = smooth(0.61, 0.67, progress);
    leadPanel.position.set(viewportMobile ? 0 : -2.55, viewportMobile ? -0.9 : -0.15, mix(-2.4, 1.45, handoffEnter));
    leadPanel.scale.setScalar((viewportMobile ? 0.55 : 0.82) * mix(0.58, 1, handoffEnter));
    leadPanel.rotation.y = (1 - handoffEnter) * 0.62;
    leadPanel.rotation.x = (1 - handoffEnter) * -0.2;
    setPanelOpacity(leadPanel, 0);

    const protocolVisibility = envelope(progress, 0.69, 0.715, 0.755, 0.78);
    const protocolEnter = smooth(0.69, 0.72, progress);

    const replaceTargets = viewportMobile ? replaceMobileTargets : replaceDesktopTargets;
    replacementPanels.forEach((panel, index) => {
      const enter = smooth(0.78 + index * 0.006, 0.805 + index * 0.006, progress);
      const visibility = enter * (1 - smooth(0.855, 0.89, progress));
      panel.position.lerpVectors(hiddenPoint, replaceTargets[index], enter);
      panel.scale.setScalar(Math.max(0.001, enter * (viewportMobile ? 0.52 : 0.82)));
      panel.rotation.y = (1 - enter) * (index % 2 ? -0.9 : 0.9);
      setPanelOpacity(panel, 0);
    });

    const caseVisibility = envelope(progress, 0.86, 0.89, 0.925, 0.952);
    const caseEnter = smooth(0.86, 0.895, progress);
    const pilotVisibility = smooth(0.94, 0.975, progress);
    pilotPlane.position.set(0, viewportMobile ? -1.05 : -1.2, 1.46);
    pilotPlane.scale.setScalar((viewportMobile ? 0.66 : 0.82) * mix(0.62, 1, pilotVisibility));
    pilotPlane.rotation.z = (1 - pilotVisibility) * -0.08;
    setPlaneOpacity(pilotPlane, 0);

    const positionAttribute = particleGeometry.attributes.position;
    const colorAttribute = particleGeometry.attributes.color;
    for (let index = 0; index < particleCount; index += 1) {
      current.copy(starts[index]).lerp(ordered[index], order);
      current.lerp(rings[index], criteria);
      current.lerp(handoffPoints[index], handoff);
      current.lerp(replacementPoints[index], Math.max(protocolPhase, replace));
      current.lerp(proofPoints[index], proof);
      current.lerp(pilotPoints[index], pilot);
      if (!paused && progress < 0.12) {
        current.x += Math.sin(motionTime * 0.22 + index) * 0.022;
        current.y += Math.cos(motionTime * 0.18 + index * 0.7) * 0.022;
      }
      positionAttribute.setXYZ(index, current.x, current.y, current.z);
      const brightness = accepted[index] ? mix(0.86, 1, Math.max(proof, pilot)) : mix(0.58, 0.035, order);
      const color = accepted[index] ? lime : warmWhite;
      colorAttribute.setXYZ(index, color.r * brightness, color.g * brightness, color.b * brightness);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    particleMaterial.opacity = 0.48 + (1 - custom) * 0.18 + proof * 0.08 + pilot * 0.12;
    stars.rotation.z = motionTime * 0.002;

    updateStoryUi(progress, viewportMobile);

    if (!document.hidden) composer.render();
    if (!ready) {
      ready = true;
      requestAnimationFrame(() => root.classList.add("is-ready"));
    }
    frameHandle = requestAnimationFrame(render);
  };

  frameHandle = requestAnimationFrame(render);

  if (fullMotion) {
    ScrollTrigger.create({
      trigger: story,
      start: "top top",
      end: "bottom bottom",
      snap: {
        snapTo: checkpoints,
        duration: viewportMobile ? { min: 0.12, max: 0.28 } : { min: 0.18, max: 0.48 },
        delay: viewportMobile ? 0.06 : 0.12,
        ease: "power2.inOut",
        inertia: false,
        directional: false,
      },
      invalidateOnRefresh: true,
    });
  }

  const refreshStory = () => {
    measureStory();
    ScrollTrigger.refresh();
  };
  window.addEventListener("load", refreshStory, { once: true });
  document.fonts?.ready.then(refreshStory);

  return () => {
    cancelAnimationFrame(frameHandle);
    window.removeEventListener("resize", resize);
    window.removeEventListener("scroll", syncScrollProgress);
    window.removeEventListener("load", refreshStory);
    ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
    renderer.dispose();
    composer.dispose();
    envMap.dispose();
  };
};

try {
  if (forceTestFallback) startFallback();
  else initScene();
} catch (error) {
  console.warn("WebGL scene unavailable; using the dynamic fallback", error);
  startFallback();
}

motionControl.addEventListener("click", () => {
  paused = !paused;
  root.classList.toggle("motion-paused", paused);
  motionControl.setAttribute("aria-pressed", String(paused));
  motionControl.querySelector("span").textContent = paused ? "Продолжить" : "Пауза";
  emitEvent(paused ? "motion_pause" : "motion_resume");
});

const openLeadDialog = (source) => {
  emitEvent("form_open", { source });
  dialog.showModal();
};

document.querySelectorAll("[data-jump='pilot']").forEach((button) => {
  button.addEventListener("click", () => {
    emitEvent("cta_click", { source: "header", target: "pilot" });
    if (!fullMotion) {
      openLeadDialog("header_reduced_motion");
      return;
    }
    const maxScroll = story.offsetHeight - window.innerHeight;
    window.scrollTo({ top: story.offsetTop + maxScroll * checkpoints.at(-2), behavior: "smooth" });
  });
});

document.querySelectorAll("[data-open-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    emitEvent("cta_click", { source: "pilot", target: "form" });
    openLeadDialog("pilot");
  });
});

initLeadCapture({ form: leadForm, emitEvent });

document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
