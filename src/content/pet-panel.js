/**
 * 宠物域
 *
 * 职责边界：
 * - 五月天五色球（面板内）：状态联动、发光与动作、状态时钟、点击互动。
 * - Codex 桌面宠物（页面上漫游）：素材加载、开关、拖拽位置/环视/大小持久化。
 * - 状态来源：渲染层经 initRender 钩子推状态（petUpdateStatus/roamPetSetStatus）；
 *   WS 域直接 import petBeginTurn/petCompleteTurn；面板状态读 panel-state.js。
 */

import { panel } from './panel-state.js';
import { statusAppearance } from '../metrics.js';
import { PET_ANSWER_STATUSES, openDataLink } from './utils.js';
import { statusText } from '../i18n.js';
import { getDisplayedAgentStatus } from './render.js';
import { create as createRoamPet } from '../pet/sprites.js';
import { createMaydayPet } from './mayday-pet.js';

let maydayPet = null;
let petCanvasEl = null;
let petStatus = 'idle';
let petTurnSessionId = '';
let petTurnSince = 0;
// 状态时钟：进入当前状态的时间点与 1s 计时器
let petStatusSince = Date.now();
let petClockTimer = null;

const PET_CLOCK_STATUSES = ['thinking', 'executing', 'replying', 'subagent', 'ratelimit'];

/* ---------- 桌面宠物（Codex Pet）状态 ----------
 * 播放器在 pet/sprites.js，官方九行动画表 + 拖拽 + 状态联动。
 * 素材库在 IndexedDB（pet/store.js，popup 写入），content script 读不到扩展
 * IDB，经 background「pet.asset.active」消息取当前宠物的 data URL；切换实时生效。
 * 拖拽停放位置持久化在 storage。开关存独立 key，不并入 widget 布局配置。 */
const ROAM_PET_STORAGE_KEY = 'kimi-statusbar.roamPet';
const PET_ACTIVE_ID_STORAGE_KEY = 'kimi-statusbar.petActiveId';
const PET_POS_STORAGE_KEY = 'kimi-statusbar.petPos';
// 环视常开（仅 v2 图集生效）：popup 已隐藏该开关，不再读 petLook 存储键
const PET_SCALE_STORAGE_KEY = 'kimi-statusbar.petScale'; // 宠物大小（百分比 50–150）
const PET_LOOK_RADIUS = 400;
let roamPet = null;
let roamPetStarting = false;
let roamPetEnabledFlag = false;
let roamPetAssetUrl = '';
let roamPetPos = null;
let roamPetScale = 1;

// 装配时注入的生命周期依赖（content.js）
let deps = {
  isDisposed: () => false,
  getSessionId: () => ''
};

export function initPet(nextDeps) {
  deps = { ...deps, ...nextDeps };
}

/* ---------- 状态时钟 ---------- */

function petClockStart() {
  if (petClockTimer) return;
  petClockTimer = setInterval(petClockTick, 1_000);
  petClockTick();
}

export function petClockTick() {
  if (!panel.els?.petClock || !panel.els.petClockNum) return;
  const pad = (n) => String(n).padStart(2, '0');
  if (!PET_CLOCK_STATUSES.includes(petStatus)) {
    // 日常：挂钟（12 小时制 h:MM，AM/PM 独立标签便于窄宽降级）
    const now = new Date();
    const hours = now.getHours();
    const h12 = hours % 12 === 0 ? 12 : hours % 12;
    panel.els.petClock.hidden = false;
    panel.els.petClockNum.textContent = `${h12}:${pad(now.getMinutes())}`;
    if (panel.els.petAmpm) panel.els.petAmpm.textContent = hours < 12 ? 'AM' : 'PM';
    return;
  }
  // 活跃状态：本轮回答（或该状态）的已用时长
  const seconds = Math.floor((Date.now() - petStatusSince) / 1_000);
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  panel.els.petClock.hidden = false;
  panel.els.petClockNum.textContent = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (panel.els.petAmpm) panel.els.petAmpm.textContent = '';
}

// 计时起点的读/写：同页切会话时由会话缓存域保存与恢复（计时连续）
export function getPetStatusSince() {
  return petStatusSince;
}

export function setPetStatusSince(timestamp) {
  petStatusSince = timestamp;
}

/* ---------- 五月天五色球 ---------- */

function petAppearanceForStatus(status) {
  const appearance = statusAppearance(status);
  if (appearance === 'off') return 'gray';
  if (appearance === 'warn') return 'red';
  return 'blue';
}

function petApplyAppearance() {
  if (!panel.els?.petCanvas) return;
  panel.els.petCanvas.dataset.appearance = petAppearanceForStatus(petStatus);
}

function petSyncState() {
  petApplyAppearance();
  maydayPet?.setStatus(petStatus);
}

export function petBeginTurn() {
  petTurnSessionId = deps.getSessionId();
  panel.petTurnActive = Boolean(deps.getSessionId());
  petTurnSince = Date.now();
}

export function petCancelTurn() {
  petTurnSessionId = '';
  panel.petTurnActive = false;
  petTurnSince = 0;
}

export function petCompleteTurn() {
  const shouldCelebrate =
    panel.petTurnActive &&
    petTurnSessionId === deps.getSessionId() &&
    Date.now() - petTurnSince > 1_000;
  petCancelTurn();
  if (shouldCelebrate) petPlayDoneEffect();
}

export function petHandleToggle() {
  maydayPet?.playClick();
}

function petPlayDoneEffect() {
  maydayPet?.celebrate();
}

export function petSyncRendering() {
  if (!maydayPet) return;
  const petInMini = panel.widgetConfig.orderMini.includes('pet');
  const collapsed = Boolean(panel.els?.widget?.classList.contains('ksb-mini')) && !petInMini;
  maydayPet.setPaused(collapsed);
}

export function petStart() {
  if (!panel.els?.petCanvas) return;
  if (maydayPet && panel.els.petCanvas === petCanvasEl) return;
  maydayPet?.destroy();
  petCanvasEl = panel.els.petCanvas;
  maydayPet = createMaydayPet(petCanvasEl, {
    onAction: () => openDataLink(panel.widgetConfig.modules.pet?.ballLink)
  });
  petSyncState();
  petSyncRendering();
  petClockStart();
}

// 庆祝只由同一会话的真实 turn 生命周期触发，重复状态不打断一次性动作。
export function petUpdateStatus(display) {
  if (panel.els?.petStatusText) {
    panel.els.petStatusText.textContent = statusText(display);
    panel.els.petStatus.dataset.status = display;
  }
  if (display === petStatus) {
    petApplyAppearance();
    return;
  }
  const previous = petStatus;
  petStatus = display;
  // 计时不被工具调用打断：仅在「非回答状态 → 回答状态」或进入非回答状态时重置起点；
  // 思考↔回复↔调用↔子代理↔限流之间切换属于同一轮回答，连续计时
  if (PET_ANSWER_STATUSES.includes(display) && !PET_ANSWER_STATUSES.includes(previous)) {
    petStatusSince = Date.now();
  } else if (!PET_ANSWER_STATUSES.includes(display)) {
    petStatusSince = Date.now();
  }
  petClockTick();
  petSyncState();
}

export function disposePet() {
  if (petClockTimer) clearInterval(petClockTimer);
  petClockTimer = null;
  maydayPet?.destroy();
  maydayPet = null;
  petCanvasEl = null;
  petCancelTurn();
  roamPetStop();
}

/* ---------- 桌面宠物（Codex Pet） ---------- */

export function roamPetSetStatus(display) {
  try {
    roamPet?.setStatus(display);
  } catch (error) {
    // 宠物动作切换失败不影响面板
  }
}

export async function roamPetStart() {
  if (roamPet || roamPetStarting || deps.isDisposed()) return;
  if (!roamPetEnabledFlag || !roamPetAssetUrl || !document.body) return;
  roamPetStarting = true;
  const assetUrl = roamPetAssetUrl;
  const startPos = roamPetPos;
  try {
    const instance = await createRoamPet({
      imageUrl: assetUrl,
      position: startPos,
      zIndex: 9998,
      scale: roamPetScale,
      look: { enabled: true, radius: PET_LOOK_RADIUS },
      onPositionChange: (pos) => {
        roamPetPos = pos;
        chrome.storage.local.set({ [PET_POS_STORAGE_KEY]: pos }).catch(() => {});
      }
    });
    // 等待素材期间页面已销毁、开关被关掉或素材已更换：立即回收，避免僵尸宠物
    if (deps.isDisposed() || !roamPetEnabledFlag || assetUrl !== roamPetAssetUrl) {
      instance.destroy();
      return;
    }
    roamPet = instance;
    roamPetSetStatus(getDisplayedAgentStatus() || 'idle');
  } catch (error) {
    console.warn('[Kimi Status] 桌面宠物加载失败', error);
  } finally {
    roamPetStarting = false;
  }
}

export function roamPetStop() {
  if (!roamPet) return;
  try {
    roamPet.destroy();
  } catch (error) {
    // 忽略
  }
  roamPet = null;
}

function roamPetApplyEnabled(enabled) {
  roamPetEnabledFlag = enabled;
  if (enabled) roamPetStart();
  else roamPetStop();
}

// 存储值（百分比 50–150）→ 缩放倍率（0.5–1.5），非法值回 1
function roamPetClampScale(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(150, Math.max(50, Math.round(n))) / 100 : 1;
}

export async function roamPetLoadConfig() {
  if (deps.isDisposed()) return;
  try {
    const stored = await chrome.storage.local.get([
      ROAM_PET_STORAGE_KEY, PET_POS_STORAGE_KEY, PET_SCALE_STORAGE_KEY
    ]);
    // 默认关闭：popup 卡片收起，页面上不出现宠物
    roamPetEnabledFlag = stored[ROAM_PET_STORAGE_KEY] === true;
    roamPetPos = stored[PET_POS_STORAGE_KEY] && Number.isFinite(stored[PET_POS_STORAGE_KEY].x)
      ? stored[PET_POS_STORAGE_KEY]
      : null;
    roamPetScale = roamPetClampScale(stored[PET_SCALE_STORAGE_KEY]);
    roamPetAssetUrl = await roamPetFetchAsset();
  } catch (error) {
    console.warn('[Kimi Status] 读取桌面宠物配置失败', error);
    roamPetEnabledFlag = false;
  }
  if (deps.isDisposed()) return;
  roamPetApplyEnabled(roamPetEnabledFlag);
}

// 经 background 从素材库取当前宠物的 data URL（未安装/未选择时为空串）
async function roamPetFetchAsset() {
  if (deps.isDisposed()) return '';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'pet.asset.active' });
    return resp?.ok && typeof resp.dataUrl === 'string' ? resp.dataUrl : '';
  } catch (error) {
    return '';
  }
}

// 桌面宠物相关的 storage 变更（popup 写入实时生效）；由 content.js 的 storage 总线调用
export function handlePetStorageChanged(changes) {
  // 桌面宠物开关（popup 写入）：缺省/删除都视为关闭
  if (changes[ROAM_PET_STORAGE_KEY]) {
    roamPetApplyEnabled(changes[ROAM_PET_STORAGE_KEY].newValue === true);
  }
  // 切换当前宠物（popup 素材库点「切换」/新装/删除后落到下一只）：重新取图重建
  if (changes[PET_ACTIVE_ID_STORAGE_KEY]) {
    roamPetFetchAsset().then((assetUrl) => {
      if (deps.isDisposed()) return;
      roamPetAssetUrl = assetUrl;
      roamPetStop();
      roamPetStart();
    });
  }
  // 宠物大小：重建宠物生效
  if (changes[PET_SCALE_STORAGE_KEY]) {
    roamPetScale = roamPetClampScale(changes[PET_SCALE_STORAGE_KEY].newValue);
    if (!deps.isDisposed()) { roamPetStop(); roamPetStart(); }
  }
}
