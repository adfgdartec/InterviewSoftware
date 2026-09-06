/**
 * The same design language as the web app, in React Native's units.
 *
 * Deliberately a hand-kept mirror of apps/web/src/app/globals.css rather than a shared token
 * package: RN has no CSS custom properties, no OKLCH and no cascade, so a "shared" module
 * would be a translation layer pretending to be a source of truth. The values below are the
 * sRGB equivalents of those tokens, and the comment names the one they came from.
 */
export const theme = {
  paper: '#faf7f9', // --color-paper
  raised: '#ffffff', // --color-raised
  sunk: '#f3eff2', // --color-sunk
  rule: '#e8e1e6', // --color-rule
  ruleFirm: '#d3c7d0', // --color-rule-firm
  ink: '#2a2229', // --color-neutral-900
  inkSoft: '#6b6169', // --color-neutral-600
  plum900: '#3b1236',
  plum700: '#6b2c64',
  plum500: '#8f5b88',
  plum100: '#f3e8f1',
  gold600: '#c9a227',
  gold100: '#fbf3d9',
  danger: '#b0392b',
  success: '#2e7d4f',
  // The interview "room": the same inversion the web session page uses.
  roomFloor: '#17131a',
  roomWall: '#221c24',
  roomStage: '#2a222c',
  roomInk: '#f2ecf1',
  roomInk2: '#b3a6b2',
  roomRule: '#3a2f3c',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
