import lottie from 'lottie-web/build/player/lottie_light.js';
import redAnimation from '../../assets/mayday/red.json' with { type: 'json' };
import blueAnimation from '../../assets/mayday/blue.json' with { type: 'json' };
import pinkAnimation from '../../assets/mayday/pink.json' with { type: 'json' };
import orangeAnimation from '../../assets/mayday/orange.json' with { type: 'json' };
import greenAnimation from '../../assets/mayday/green.json' with { type: 'json' };

const EFFECT_CLASSES = ['ksb-mayday-clicking', 'ksb-mayday-celebrating'];

const MAYDAY_MEMBERS = [
  { id: 'red', color: '#ff6572', animationData: redAnimation },
  { id: 'blue', color: '#5bbcff', animationData: blueAnimation },
  { id: 'pink', color: '#ff8fbf', animationData: pinkAnimation },
  { id: 'orange', color: '#ffb452', animationData: orangeAnimation },
  { id: 'green', color: '#69ce83', animationData: greenAnimation }
];

function ballShell(member, index) {
  return `
    <div class="ksb-mayday-ball ksb-mayday-${member.id}" data-member="${member.id}" data-active="${index === 0}" style="--i:${index};--glow:${member.color}">
      <span class="ksb-mayday-aura"></span>
      <div class="ksb-mayday-sprite" data-sprite="${member.id}"></div>
    </div>`;
}

export function maydayPetHTML() {
  return `
    <div id="ksb-pet-canvas" class="ksb-pet-canvas ksb-mayday-pet" role="button" tabindex="0" aria-label="五月天五色球，每 5 秒轮换，点击播放动画" data-status="idle" data-appearance="blue" data-paused="false">
      <div class="ksb-mayday-stage">
        ${MAYDAY_MEMBERS.map(ballShell).join('')}
      </div>
      <svg class="ksb-mayday-stars" viewBox="0 0 80 80" aria-hidden="true">
        <g transform="translate(17 13)"><path class="ksb-mayday-star" style="--i:0" d="M0-5 1.45-1.65 5-1.55 2.35.85 3.15 4.5 0 2.45-3.15 4.5-2.35.85-5-1.55-1.45-1.65Z" fill="#ffd76a"/></g>
        <g transform="translate(39 5)"><path class="ksb-mayday-star" style="--i:1" d="M0-5 1.45-1.65 5-1.55 2.35.85 3.15 4.5 0 2.45-3.15 4.5-2.35.85-5-1.55-1.45-1.65Z" fill="#8bd8ff"/></g>
        <g transform="translate(63 14)"><path class="ksb-mayday-star" style="--i:2" d="M0-5 1.45-1.65 5-1.55 2.35.85 3.15 4.5 0 2.45-3.15 4.5-2.35.85-5-1.55-1.45-1.65Z" fill="#ffadd2"/></g>
        <g transform="translate(23 29)"><path class="ksb-mayday-star" style="--i:3" d="M0-5 1.45-1.65 5-1.55 2.35.85 3.15 4.5 0 2.45-3.15 4.5-2.35.85-5-1.55-1.45-1.65Z" fill="#ffe29a"/></g>
        <g transform="translate(59 31)"><path class="ksb-mayday-star" style="--i:4" d="M0-5 1.45-1.65 5-1.55 2.35.85 3.15 4.5 0 2.45-3.15 4.5-2.35.85-5-1.55-1.45-1.65Z" fill="#a4edbc"/></g>
      </svg>
    </div>`;
}

export function createMaydayPet(element, { onAction, rotationInterval = 5000, createAnimation } = {}) {
  if (!element) throw new Error('Mayday pet element is required');
  const interval = Number.isFinite(Number(rotationInterval)) && Number(rotationInterval) > 0
    ? Number(rotationInterval)
    : 5000;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const animationFactory = createAnimation || (({ container, animationData }) => lottie.loadAnimation({
    container,
    animationData,
    renderer: 'svg',
    loop: true,
    autoplay: false,
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
  }));
  const balls = [...element.querySelectorAll('.ksb-mayday-ball')];
  const players = new Map();
  let memberIndex = 0;
  let effectTimer = null;
  let rotationTimer = null;
  let paused = false;
  let destroyed = false;

  for (const ball of balls) {
    const member = MAYDAY_MEMBERS.find((item) => item.id === ball.dataset.member);
    if (!member) continue;
    const player = animationFactory({
      container: ball.querySelector('.ksb-mayday-sprite'),
      animationData: member.animationData
    });
    players.set(member.id, player);
  }

  function syncPlayers() {
    for (const ball of balls) {
      const player = players.get(ball.dataset.member);
      if (!player) continue;
      const shouldPlay = !destroyed && !paused && !reducedMotion && ball.dataset.active === 'true';
      if (shouldPlay) player.play();
      else player.pause();
    }
  }

  function showMember(index) {
    memberIndex = index;
    for (const ball of balls) {
      ball.dataset.active = String(ball.dataset.member === MAYDAY_MEMBERS[memberIndex].id);
    }
    syncPlayers();
  }

  function stopRotation() {
    if (rotationTimer) clearInterval(rotationTimer);
    rotationTimer = null;
  }

  function startRotation() {
    if (destroyed || paused || reducedMotion || effectTimer || rotationTimer) return;
    rotationTimer = setInterval(() => {
      showMember((memberIndex + 1) % MAYDAY_MEMBERS.length);
    }, interval);
  }

  function runEffect(className, duration) {
    if (destroyed) return;
    stopRotation();
    if (effectTimer) clearTimeout(effectTimer);
    element.classList.remove(...EFFECT_CLASSES);
    element.getBoundingClientRect();
    element.classList.add(className);
    effectTimer = setTimeout(() => {
      element.classList.remove(className);
      effectTimer = null;
      startRotation();
    }, duration);
  }

  function playClick() {
    runEffect('ksb-mayday-clicking', 1100);
  }

  function celebrate() {
    runEffect('ksb-mayday-celebrating', 1900);
  }

  function handleAction(event) {
    if (element.closest('.ksb-editing')) return;
    event.stopPropagation();
    playClick();
    onAction?.(event);
  }

  function handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleAction(event);
  }

  element.addEventListener('click', handleAction);
  element.addEventListener('keydown', handleKeydown);
  showMember(0);
  if (reducedMotion) {
    for (const player of players.values()) player.goToAndStop?.(0, true);
  }
  startRotation();

  return {
    setStatus(status) {
      element.dataset.status = status || 'idle';
    },
    playClick,
    celebrate,
    setPaused(nextPaused) {
      paused = Boolean(nextPaused);
      element.dataset.paused = String(paused);
      if (paused) stopRotation();
      else startRotation();
      syncPlayers();
    },
    destroy() {
      destroyed = true;
      stopRotation();
      if (effectTimer) clearTimeout(effectTimer);
      effectTimer = null;
      element.removeEventListener('click', handleAction);
      element.removeEventListener('keydown', handleKeydown);
      element.classList.remove(...EFFECT_CLASSES);
      for (const player of players.values()) player.destroy?.();
      players.clear();
    }
  };
}
