/**
 * Deep-water palette.
 *
 * The board reads as dark water rather than black: a teal-shifted ground keeps
 * the glows looking like light in a medium instead of stickers on a void.
 * Warm amber against cool jade separates the two sides by hue and by
 * brightness, so the map stays readable for colour-blind players.
 */
export const COLORS = {
  water: 0x071a20,
  waterDeep: 0x04121a,
  filament: 0x11323b,
  filamentLive: 0x1d525e,
  silt: 0x6e8189,
  siltCore: 0x2b3a41,
  amber: 0xf5a94e,
  amberCore: 0x6b4218,
  jade: 0x3fd6c1,
  jadeCore: 0x12534d,
  orchid: 0xb98cf0,
  orchidCore: 0x3d2a63,
  rose: 0xf4739c,
  roseCore: 0x5e1f38,
  sky: 0x5ea8ff,
  skyCore: 0x14335e,
  citron: 0xcfe04a,
  citronCore: 0x4a5210,
  foam: 0xe6f2f0,
} as const;

export interface Faction {
  glow: number;
  core: number;
  label: string;
}

export const NEUTRAL_FACTION: Faction = {
  glow: COLORS.silt,
  core: COLORS.siltCore,
  label: 'Нейтральные',
};

/**
 * Seats in play order. The first is always the human.
 *
 * The four hues sit far apart in both tone and brightness, so a colour-blind
 * player can still tell which glow is whose.
 */
export const FACTIONS: Faction[] = [
  { glow: COLORS.amber, core: COLORS.amberCore, label: 'Вы' },
  { glow: COLORS.jade, core: COLORS.jadeCore, label: 'Нефрит' },
  { glow: COLORS.orchid, core: COLORS.orchidCore, label: 'Орхидея' },
  { glow: COLORS.rose, core: COLORS.roseCore, label: 'Роза' },
  { glow: COLORS.sky, core: COLORS.skyCore, label: 'Лазурь' },
  { glow: COLORS.citron, core: COLORS.citronCore, label: 'Лимон' },
];

/** Players that can sit at one table, the human included. */
export const MAX_PLAYERS = FACTIONS.length;

export function factionOf(owner: number): Faction {
  return FACTIONS[owner] ?? NEUTRAL_FACTION;
}

export const FONT_FAMILY = 'Manrope, system-ui, sans-serif';
