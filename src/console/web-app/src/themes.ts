// ViewIO: chủ đề giao diện (theme). Mỗi theme gồm bộ màu cho Console (qua override theme của mds), cho các thành phần của
// ViewIO (biến CSS --vio-*), cho viewer/trình soạn thảo (--dv-*, --hl-*) và cho CodeMirror (đọc lại các biến CSS đó).
// "light"/"dark" là giao diện gốc của Console; các theme còn lại chỉ là bộ màu bổ sung.

import { AppDispatch } from "./store";
import { setDarkMode, setOverrideStyles } from "./systemSlice";
import { storeDarkMode } from "./utils/stylesUtils";
import { IEmbeddedCustomStyles } from "./common/types";

interface Palette {
  bg: string;
  box: string;
  text: string;
  muted: string;
  border: string;
  hover: string;
  accent: string;
  accentText: string;
  code: string;
  ok: string;
  err: string;
  warn: string;
  hl: { keyword: string; string: string; number: string; comment: string; title: string; attr: string };
}

export interface ThemeDef {
  id: string;
  label: string;
  dark: boolean;
  builtin?: boolean; // giao diện gốc của Console, không ghi đè màu Console
  p: Palette;
}

const LIGHT: Palette = {
  bg: "#ffffff", box: "#ffffff", text: "#1f2933", muted: "#6b7785", border: "#d9dee5", hover: "#e8ecf1",
  accent: "#2563eb", accentText: "#ffffff", code: "#fbfcfd", ok: "#2fb76d", err: "#c83b51", warn: "#e0a500",
  hl: { keyword: "#cf222e", string: "#0a3069", number: "#0550ae", comment: "#6e7781", title: "#8250df", attr: "#116329" },
};
const DARK: Palette = {
  bg: "#14181d", box: "#1d232a", text: "#e4e8ec", muted: "#9aa5b1", border: "#323a44", hover: "#2a323b",
  accent: "#4c8dff", accentText: "#ffffff", code: "#171c22", ok: "#2fb76d", err: "#e5586e", warn: "#e0a500",
  hl: { keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", title: "#d2a8ff", attr: "#7ee787" },
};

export const THEMES: ThemeDef[] = [
  { id: "light", label: "Sáng", dark: false, builtin: true, p: LIGHT },
  { id: "dark", label: "Tối", dark: true, builtin: true, p: DARK },
  {
    id: "midnight", label: "Midnight (xanh đêm)", dark: true,
    p: { bg: "#0b1220", box: "#111a2e", text: "#e6edf7", muted: "#93a4c0", border: "#25344f", hover: "#1a2640", accent: "#4f8cff", accentText: "#ffffff", code: "#0d1626", ok: "#34c38f", err: "#ff6b81", warn: "#f5b942",
      hl: { keyword: "#ff8fa3", string: "#9ad1ff", number: "#ffd479", comment: "#7589a8", title: "#b69cff", attr: "#7ee0b5" } },
  },
  {
    id: "graphite", label: "Graphite (than chì)", dark: true,
    p: { bg: "#151517", box: "#1e1e21", text: "#e8e8ea", muted: "#9a9aa2", border: "#35353b", hover: "#2a2a2f", accent: "#7aa2f7", accentText: "#101014", code: "#19191c", ok: "#9ece6a", err: "#f7768e", warn: "#e0af68",
      hl: { keyword: "#f7768e", string: "#9ece6a", number: "#ff9e64", comment: "#6b7089", title: "#bb9af7", attr: "#73daca" } },
  },
  {
    id: "nord", label: "Nord", dark: true,
    p: { bg: "#2e3440", box: "#3b4252", text: "#e5e9f0", muted: "#a3adbf", border: "#4c566a", hover: "#434c5e", accent: "#88c0d0", accentText: "#2e3440", code: "#2b303b", ok: "#a3be8c", err: "#bf616a", warn: "#ebcb8b",
      hl: { keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", comment: "#7b88a1", title: "#88c0d0", attr: "#ebcb8b" } },
  },
  {
    id: "solarized", label: "Solarized tối", dark: true,
    p: { bg: "#002b36", box: "#073642", text: "#93a1a1", muted: "#7b9097", border: "#134b58", hover: "#0b3f4c", accent: "#2aa198", accentText: "#002b36", code: "#00252e", ok: "#859900", err: "#dc322f", warn: "#b58900",
      hl: { keyword: "#dc322f", string: "#2aa198", number: "#d33682", comment: "#586e75", title: "#268bd2", attr: "#b58900" } },
  },
  {
    id: "forest", label: "Rừng (xanh lá tối)", dark: true,
    p: { bg: "#0f1a14", box: "#16251c", text: "#e3efe6", muted: "#8fae99", border: "#274533", hover: "#1d3326", accent: "#3fb97a", accentText: "#06210f", code: "#0c1610", ok: "#3fb97a", err: "#ef6b6b", warn: "#e6b94d",
      hl: { keyword: "#f0a07a", string: "#9ee6b8", number: "#f2d479", comment: "#6f8f7b", title: "#8fd0ff", attr: "#c2e68a" } },
  },
  {
    id: "sepia", label: "Sepia (giấy ấm)", dark: false,
    p: { bg: "#f3ead8", box: "#fbf6ea", text: "#3d3226", muted: "#7a6b55", border: "#dccfb4", hover: "#eadfc6", accent: "#b45309", accentText: "#ffffff", code: "#fdf9ef", ok: "#2f855a", err: "#c53030", warn: "#b7791f",
      hl: { keyword: "#9b2c2c", string: "#276749", number: "#2c5282", comment: "#8a7d68", title: "#6b46c1", attr: "#975a16" } },
  },
];

const KEY = "viewio.theme";
const STYLE_ID = "vio-theme-style";

export const getThemeId = (): string => {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
};

const byId = (id: string) => THEMES.find((t) => t.id === id);

const mdsStyles = (p: Palette): IEmbeddedCustomStyles => {
  const btn = {
    backgroundColor: p.accent, textColor: p.accentText, hoverColor: p.accent, hoverText: p.accentText,
    activeColor: p.accent, activeText: p.accentText, disabledColor: p.border, disabledText: p.muted,
  };
  const ghost = {
    backgroundColor: "transparent", textColor: p.text, hoverColor: p.hover, hoverText: p.accent,
    activeColor: p.hover, activeText: p.accent, disabledColor: p.border, disabledText: p.muted,
  };
  return {
    backgroundColor: p.bg, fontColor: p.text, secondaryFontColor: p.muted, borderColor: p.border, loaderColor: p.accent,
    boxBackground: p.box, okColor: p.ok, errorColor: p.err, warnColor: p.warn, linkColor: p.accent,
    disabledLinkColor: p.muted, hoverLinkColor: p.accent,
    tableColors: { border: p.border, disabledBorder: p.border, disabledBG: p.box, selected: p.hover, deletedDisabled: p.box, hoverColor: p.hover },
    buttonStyles: btn, secondaryButtonStyles: ghost, regularButtonStyles: ghost,
    inputBox: { border: p.border, hoverBorder: p.accent, textColor: p.text, backgroundColor: p.box },
    switch: {
      switchBackground: p.border, bulletBorderColor: p.border, bulletBGColor: p.text,
      disabledBackground: p.border, disabledBulletBorderColor: p.border, disabledBulletBGColor: p.muted,
    },
  };
};

// Biến CSS cho ViewIO (menu, hộp thoại, chuông, nút Mới) + viewer/soạn thảo
const css = (t: ThemeDef) => {
  const p = t.p;
  const line = t.dark ? "rgba(255,255,255,0.18)" : "rgba(60,70,85,0.30)";
  const hoverA = t.dark ? "rgba(255,255,255,0.08)" : "rgba(60,70,85,0.10)";
  let out = `:root{--vio-bg:${p.box};--vio-fg:${p.text};--vio-muted:${p.muted};--vio-line:${line};--vio-hover:${hoverA};` +
    `--vio-accent:${p.accent};--vio-accent-text:${p.accentText};--vio-shadow:rgba(0,0,0,${t.dark ? 0.6 : 0.3});color-scheme:${t.dark ? "dark" : "light"};}`;
  if (!t.builtin) {
    const v = `--dv-bg:${p.bg};--dv-panel:${p.box};--dv-text:${p.text};--dv-muted:${p.muted};--dv-border:${p.border};--dv-hover:${p.hover};` +
      `--dv-accent:${p.accent};--dv-accent-text:${p.accentText};--dv-code-bg:${p.code};` +
      `--hl-keyword:${p.hl.keyword};--hl-string:${p.hl.string};--hl-number:${p.hl.number};--hl-comment:${p.hl.comment};--hl-title:${p.hl.title};--hl-attr:${p.hl.attr};`;
    out += `html .dv-root,html .dv-root.dv-dark{${v}}`;
  }
  return out;
};

const injectCss = (t: ThemeDef) => {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css(t);
  document.documentElement.setAttribute("data-vio-theme", t.id);
};

export const applyTheme = (dispatch: AppDispatch, id: string) => {
  const t = byId(id) || THEMES[0];
  try {
    localStorage.setItem(KEY, t.id);
  } catch {
    // bỏ qua
  }
  storeDarkMode(t.dark ? "on" : "off");
  dispatch(setDarkMode(t.dark));
  dispatch(setOverrideStyles((t.builtin ? null : mdsStyles(t.p)) as IEmbeddedCustomStyles));
  injectCss(t);
};

// Khi khởi động: nếu đã chọn theme thì áp dụng; không thì biến CSS theo chế độ sáng/tối hiện tại
export const initTheme = (dispatch: AppDispatch, darkMode: boolean) => {
  const saved = byId(getThemeId());
  if (saved && !saved.builtin) {
    applyTheme(dispatch, saved.id);
  } else {
    injectCss(darkMode ? THEMES[1] : THEMES[0]);
  }
};

// Nút trăng/mặt trời của Console đổi chế độ: đồng bộ biến CSS (và bỏ theme màu nếu không còn khớp sáng/tối)
export const syncThemeWithMode = (dark: boolean) => {
  const cur = byId(getThemeId());
  if (cur && !cur.builtin && cur.dark === dark) {
    injectCss(cur);
  } else {
    injectCss(dark ? THEMES[1] : THEMES[0]);
  }
};
