/** JSON-style theme definitions. Each theme maps semantic tokens to hex colors. */

export interface ThemeColors {
  /* surface palette */
  bg: string;
  surface: string;
  "surface-raised": string;
  "surface-hover": string;
  border: string;
  "border-strong": string;

  /* text */
  fg: string;
  "fg-muted": string;
  "fg-dim": string;
  "fg-error": string;

  /* accents */
  accent: string;
  "accent-hover": string;
  "accent-selection": string;
  "icon-folder": string;
  "icon-chat": string;

  /* scrollbar */
  "scrollbar-thumb": string;
  "scrollbar-thumb-hover": string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  type: "dark" | "light";
  colors: ThemeColors;
}

/* ── Built-in themes ──────────────────────────────────────────────── */

const dark: ThemeDefinition = {
  id: "dark",
  name: "Dark",
  type: "dark",
  colors: {
    bg: "#1e1e1e",
    surface: "#181818",
    "surface-raised": "#252526",
    "surface-hover": "#2a2d2e",
    border: "#2b2b2b",
    "border-strong": "#454545",
    fg: "#cccccc",
    "fg-muted": "#808080",
    "fg-dim": "#555555",
    "fg-error": "#f48771",
    accent: "#0e639c",
    "accent-hover": "#1177bb",
    "accent-selection": "#094771",
    "icon-folder": "#dcb67a",
    "icon-chat": "#75beff",
    "scrollbar-thumb": "rgba(255,255,255,0.1)",
    "scrollbar-thumb-hover": "rgba(255,255,255,0.2)",
  },
};

const light: ThemeDefinition = {
  id: "light",
  name: "Light",
  type: "light",
  colors: {
    bg: "#ffffff",
    surface: "#f5f5f5",
    "surface-raised": "#e8e8e8",
    "surface-hover": "#d6d6d6",
    border: "#d4d4d4",
    "border-strong": "#b0b0b0",
    fg: "#1e1e1e",
    "fg-muted": "#6e6e6e",
    "fg-dim": "#a0a0a0",
    "fg-error": "#d32f2f",
    accent: "#0e639c",
    "accent-hover": "#1177bb",
    "accent-selection": "#add6ff",
    "icon-folder": "#c09553",
    "icon-chat": "#0078d4",
    "scrollbar-thumb": "rgba(0,0,0,0.15)",
    "scrollbar-thumb-hover": "rgba(0,0,0,0.25)",
  },
};

const gruvboxDark: ThemeDefinition = {
  id: "gruvbox-dark",
  name: "Gruvbox Dark",
  type: "dark",
  colors: {
    bg: "#282828",
    surface: "#1d2021",
    "surface-raised": "#3c3836",
    "surface-hover": "#504945",
    border: "#3c3836",
    "border-strong": "#665c54",
    fg: "#ebdbb2",
    "fg-muted": "#a89984",
    "fg-dim": "#665c54",
    "fg-error": "#fb4934",
    accent: "#458588",
    "accent-hover": "#83a598",
    "accent-selection": "#3c4841",
    "icon-folder": "#fabd2f",
    "icon-chat": "#83a598",
    "scrollbar-thumb": "rgba(235,219,178,0.1)",
    "scrollbar-thumb-hover": "rgba(235,219,178,0.2)",
  },
};

const gruvboxLight: ThemeDefinition = {
  id: "gruvbox-light",
  name: "Gruvbox Light",
  type: "light",
  colors: {
    bg: "#fbf1c7",
    surface: "#f2e5bc",
    "surface-raised": "#ebdbb2",
    "surface-hover": "#d5c4a1",
    border: "#d5c4a1",
    "border-strong": "#a89984",
    fg: "#3c3836",
    "fg-muted": "#665c54",
    "fg-dim": "#a89984",
    "fg-error": "#cc241d",
    accent: "#458588",
    "accent-hover": "#076678",
    "accent-selection": "#c8dbbe",
    "icon-folder": "#d79921",
    "icon-chat": "#076678",
    "scrollbar-thumb": "rgba(60,56,54,0.15)",
    "scrollbar-thumb-hover": "rgba(60,56,54,0.25)",
  },
};

const catppuccinMocha: ThemeDefinition = {
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  type: "dark",
  colors: {
    bg: "#1e1e2e",
    surface: "#181825",
    "surface-raised": "#313244",
    "surface-hover": "#45475a",
    border: "#313244",
    "border-strong": "#585b70",
    fg: "#cdd6f4",
    "fg-muted": "#a6adc8",
    "fg-dim": "#585b70",
    "fg-error": "#f38ba8",
    accent: "#89b4fa",
    "accent-hover": "#b4d0fb",
    "accent-selection": "#2e3a5e",
    "icon-folder": "#f9e2af",
    "icon-chat": "#89dceb",
    "scrollbar-thumb": "rgba(205,214,244,0.1)",
    "scrollbar-thumb-hover": "rgba(205,214,244,0.2)",
  },
};

const catppuccinLatte: ThemeDefinition = {
  id: "catppuccin-latte",
  name: "Catppuccin Latte",
  type: "light",
  colors: {
    bg: "#eff1f5",
    surface: "#e6e9ef",
    "surface-raised": "#ccd0da",
    "surface-hover": "#bcc0cc",
    border: "#ccd0da",
    "border-strong": "#9ca0b0",
    fg: "#4c4f69",
    "fg-muted": "#6c6f85",
    "fg-dim": "#9ca0b0",
    "fg-error": "#d20f39",
    accent: "#1e66f5",
    "accent-hover": "#0550c8",
    "accent-selection": "#c5d0f5",
    "icon-folder": "#df8e1d",
    "icon-chat": "#04a5e5",
    "scrollbar-thumb": "rgba(76,79,105,0.15)",
    "scrollbar-thumb-hover": "rgba(76,79,105,0.25)",
  },
};

const nord: ThemeDefinition = {
  id: "nord",
  name: "Nord",
  type: "dark",
  colors: {
    bg: "#2e3440",
    surface: "#272c36",
    "surface-raised": "#3b4252",
    "surface-hover": "#434c5e",
    border: "#3b4252",
    "border-strong": "#4c566a",
    fg: "#d8dee9",
    "fg-muted": "#81a1c1",
    "fg-dim": "#4c566a",
    "fg-error": "#bf616a",
    accent: "#5e81ac",
    "accent-hover": "#81a1c1",
    "accent-selection": "#3b4f6e",
    "icon-folder": "#ebcb8b",
    "icon-chat": "#88c0d0",
    "scrollbar-thumb": "rgba(216,222,233,0.1)",
    "scrollbar-thumb-hover": "rgba(216,222,233,0.2)",
  },
};

const nordLight: ThemeDefinition = {
  id: "nord-light",
  name: "Nord Light",
  type: "light",
  colors: {
    bg: "#eceff4",
    surface: "#e5e9f0",
    "surface-raised": "#d8dee9",
    "surface-hover": "#c8ced9",
    border: "#d8dee9",
    "border-strong": "#a5b0c5",
    fg: "#2e3440",
    "fg-muted": "#4c566a",
    "fg-dim": "#a5b0c5",
    "fg-error": "#bf616a",
    accent: "#5e81ac",
    "accent-hover": "#4c6b91",
    "accent-selection": "#c5d4e8",
    "icon-folder": "#d08770",
    "icon-chat": "#5e81ac",
    "scrollbar-thumb": "rgba(46,52,64,0.15)",
    "scrollbar-thumb-hover": "rgba(46,52,64,0.25)",
  },
};

/* ── Registry ─────────────────────────────────────────────────────── */

export const THEMES: ThemeDefinition[] = [
  dark,
  light,
  gruvboxDark,
  gruvboxLight,
  catppuccinMocha,
  catppuccinLatte,
  nord,
  nordLight,
];

export const THEME_MAP: Record<string, ThemeDefinition> = Object.fromEntries(
  THEMES.map((t) => [t.id, t])
);

/** Apply a theme by setting CSS custom properties on :root */
export function applyTheme(themeId: string): void {
  const theme = THEME_MAP[themeId];
  if (!theme) return;

  const root = document.documentElement;
  const { colors } = theme;

  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(`--color-${key}`, value);
  }

  root.setAttribute("data-theme", theme.type);
}
