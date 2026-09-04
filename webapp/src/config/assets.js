// config/assets.js — Spec v2 §7 最終資產清單 → 實際路徑（ASSET_MAP，集中管理；舊 v1 路徑唔好再引用）。
// 產生方法：python tools/build-assets-v2.py（由 assets-raw/v2/ 出）。

const V2 = 'assets/v2/';

export const ASSET_MAP = Object.freeze({
  // 背景（1）— 單張，視差已取消
  BG_lab_full: V2 + 'bg_lab_full.webp',
  BG_lab_full_small: V2 + 'bg_lab_full_small.webp',

  // 器皿（5）— 768×768 原稿，內容高度 722px；縮到 512
  VES_flask_empty: V2 + 'flask.webp',
  VES_flask_frosted: V2 + 'flask_frosted.webp',
  VES_flask_cracked: V2 + 'flask_cracked.webp',
  VES_retort_empty: V2 + 'retort.webp',
  VES_retort_frosted: V2 + 'retort_frosted.webp',
  VES_geometry: V2 + 'vessels.json',

  // 液體與配料（3）
  LIQ_base: V2 + 'liq_base.png',
  PAT_tile_large: V2 + 'pat_large.png',
  PAT_tile_small: V2 + 'pat_small.png',

  // 遮蓋（3）
  VES_cloth_cover: V2 + 'cloth_cover.webp',
  VES_wax_seal: V2 + 'wax_seal.png',    // 蠟餅，可 tint
  VES_wax_ring: V2 + 'wax_ring.png',    // 黃銅框，永不 tint

  // 角色（8）
  CHR_cat_idle: V2 + 'cat_idle.webp',
  CHR_cat_happy: V2 + 'cat_happy.webp',
  CHR_cat_cheer: V2 + 'cat_cheer.webp',
  CHR_client_owl: V2 + 'client_owl.webp',
  CHR_client_raven: V2 + 'client_raven.webp',
  CHR_client_badger: V2 + 'client_badger.webp',
  CHR_client_hare: V2 + 'client_hare.webp',
  CHR_doctor_silhouette: V2 + 'doctor_silhouette.webp',

  // UI（17）
  UI_ad_crest: V2 + 'ui_ad_crest.webp',
  UI_btn_primary: V2 + 'ui_btn_primary.webp',
  UI_btn_secondary: V2 + 'ui_btn_secondary.webp',
  UI_btn_danger: V2 + 'ui_btn_danger.webp',
  UI_btn_disabled: V2 + 'ui_btn_disabled.webp',
  UI_panel_dialog: V2 + 'ui_panel_dialog.webp',
  UI_panel_info: V2 + 'ui_panel_info.webp',
  UI_item_undo: V2 + 'ui_item_undo.webp',
  UI_item_hint: V2 + 'ui_item_hint.webp',
  UI_item_addflask: V2 + 'ui_item_addflask.webp',
  UI_item_swap: V2 + 'ui_item_swap.webp',
  UI_sys_back: V2 + 'ui_sys_back.webp',
  UI_sys_settings: V2 + 'ui_sys_settings.webp',
  UI_sys_shop: V2 + 'ui_sys_shop.webp',
  UI_sys_daily: V2 + 'ui_sys_daily.webp',
  UI_sys_codex: V2 + 'ui_sys_codex.webp',
  UI_coin: V2 + 'ui_coin.webp',
  UI_star: V2 + 'ui_star.webp',
  UI_star_dim: V2 + 'ui_star_dim.webp',
  UI_progressbar: V2 + 'ui_progressbar.webp',

  // 未換嘅舊素材（公司 logo / 字標仍然用）
  company_logo: 'assets/company-logo.webp',
  wordmark: 'assets/meowcha-wordmark.webp',
});

/** 器皿 kind → sprite key */
export const VESSEL_SPRITE = Object.freeze({
  normal: 'VES_flask_empty',
  frosted: 'VES_flask_frosted',
  cracked: 'VES_flask_cracked',
  takeaway: 'VES_retort_empty',
  takeaway_frosted: 'VES_retort_frosted',
  covered: 'VES_flask_empty',   // 布遮瓶底下係 flask（布固定尺寸，唔會露出瓶型）
});

/** 委託人 key（Spec §6 解鎖順序 raven → badger → owl → hare） */
export const CLIENT_SPRITE = Object.freeze({
  raven: 'CHR_client_raven', badger: 'CHR_client_badger', owl: 'CHR_client_owl', hare: 'CHR_client_hare',
});
