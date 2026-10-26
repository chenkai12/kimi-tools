import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { maydayPetHTML, createMaydayPet } from '../src/content/mayday-pet.js';

function fixture(options = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  const { window } = dom;
  window.document.body.innerHTML = maydayPetHTML();
  const element = window.document.getElementById('ksb-pet-canvas');
  let actions = 0;
  const players = [];
  const createAnimation = options.createAnimation || (({ container, animationData }) => {
    const player = {
      container,
      animationData,
      playCount: 0,
      pauseCount: 0,
      destroyed: false,
      firstFrame: false,
      play() { this.playCount += 1; },
      pause() { this.pauseCount += 1; },
      goToAndStop() { this.firstFrame = true; },
      destroy() { this.destroyed = true; }
    };
    players.push(player);
    return player;
  });
  const controller = createMaydayPet(element, {
    ...options,
    createAnimation,
    onAction: () => { actions += 1; }
  });
  return { dom, window, element, controller, players, actions: () => actions };
}

test('五色球：五份 Lottie 数据全部本地加载，初始只有红球播放', () => {
  const { dom, element, controller, players } = fixture();
  try {
    const balls = [...element.querySelectorAll('.ksb-mayday-ball')];
    assert.deepEqual(
      balls.map((ball) => ball.dataset.member),
      ['red', 'blue', 'pink', 'orange', 'green']
    );
    const sprites = [...element.querySelectorAll('.ksb-mayday-sprite')];
    assert.deepEqual(sprites.map((sprite) => sprite.dataset.sprite), ['red', 'blue', 'pink', 'orange', 'green']);
    assert.deepEqual(players.map((player) => player.animationData.nm), [
      '五月天五球 · 阿信', '五月天五球 · 怪兽', '五月天五球 · 玛莎', '五月天五球 · 石头', '五月天五球 · 冠佑'
    ]);
    assert.equal(players.filter((player) => player.playCount > 0).length, 1, '初始只有当前球播放');
    assert.equal(players[0].playCount, 1);
    assert.ok(players.slice(1).every((player) => player.pauseCount > 0));
    assert.equal(element.querySelectorAll('.ksb-mayday-aura').length, 5);
    assert.equal(element.querySelectorAll('.ksb-mayday-star').length, 5);
    assert.equal(element.querySelectorAll('.ksb-mayday-ball[data-active="true"]').length, 1, '初始只显示一个球');
    assert.equal(element.querySelector('.ksb-mayday-ball[data-active="true"]').dataset.member, 'red');
    assert.equal(element.getAttribute('role'), 'button');
    assert.equal(element.getAttribute('tabindex'), '0');
  } finally {
    controller.destroy();
    dom.window.close();
  }
});

test('五色球：定时轮换仍只显示一个，暂停后保持当前球', async () => {
  const { dom, element, controller } = fixture({ rotationInterval: 25 });
  const activeMember = () => element.querySelector('.ksb-mayday-ball[data-active="true"]')?.dataset.member;
  try {
    assert.equal(activeMember(), 'red');
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.notEqual(activeMember(), 'red', '到时间应切换角色');
    assert.equal(element.querySelectorAll('.ksb-mayday-ball[data-active="true"]').length, 1);
    controller.setPaused(true);
    const pausedMember = activeMember();
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.equal(activeMember(), pausedMember, '暂停期间不应换球');
    controller.setPaused(false);
    await new Promise((resolve) => setTimeout(resolve, 45));
    assert.notEqual(activeMember(), pausedMember, '恢复后应继续轮换');
  } finally {
    controller.destroy();
    dom.window.close();
  }
});

test('五色球：状态切换不打断一次性动作，暂停与销毁语义完整', () => {
  const { dom, element, controller, players } = fixture();
  try {
    controller.setStatus('thinking');
    assert.equal(element.dataset.status, 'thinking');
    controller.playClick();
    assert.ok(element.classList.contains('ksb-mayday-clicking'));
    controller.setStatus('executing');
    assert.ok(element.classList.contains('ksb-mayday-clicking'), '状态刷新不应打断点击动画');
    controller.setPaused(true);
    assert.equal(element.dataset.paused, 'true');
    controller.setPaused(false);
    assert.equal(element.dataset.paused, 'false');
    controller.celebrate();
    assert.ok(!element.classList.contains('ksb-mayday-clicking'));
    assert.ok(element.classList.contains('ksb-mayday-celebrating'));
    controller.destroy();
    assert.ok(!element.classList.contains('ksb-mayday-celebrating'));
    assert.ok(players.every((player) => player.destroyed), '销毁时应清理全部 Lottie 播放器');
  } finally {
    controller.destroy();
    dom.window.close();
  }
});

test('五色球：鼠标、Enter 和空格都触发同一互动', () => {
  const { dom, window, element, controller, actions } = fixture();
  try {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(actions(), 1);
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(actions(), 2);
    element.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    assert.equal(actions(), 3);
    assert.ok(element.classList.contains('ksb-mayday-clicking'));
  } finally {
    controller.destroy();
    dom.window.close();
  }
});

test('五色球：点击动作结束后恢复基底状态', async () => {
  const { dom, element, controller } = fixture();
  try {
    controller.playClick();
    assert.ok(element.classList.contains('ksb-mayday-clicking'));
    await new Promise((resolve) => setTimeout(resolve, 1150));
    assert.ok(!element.classList.contains('ksb-mayday-clicking'));
  } finally {
    controller.destroy();
    dom.window.close();
  }
});

test('五色球：减少动态效果时只显示第一帧且不自动轮换', async () => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  const { dom, element, controller, players } = fixture({ rotationInterval: 10 });
  try {
    assert.ok(players.every((player) => player.firstFrame));
    assert.ok(players.every((player) => player.playCount === 0));
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(element.querySelector('.ksb-mayday-ball[data-active="true"]').dataset.member, 'red');
  } finally {
    controller.destroy();
    dom.window.close();
    if (previous === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = previous;
  }
});
