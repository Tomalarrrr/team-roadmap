// Battlefield themes for Slugs. Each is a small, closed palette: the land, its
// top edge and its outline are drawn from these colours only, so a theme reads
// as one place. Painters live in slugArt.ts and slugBackdrop.ts; this file is data.

export type ThemeId =
  | 'tropical'
  | 'countryside'
  | 'canyon'
  | 'snow'
  | 'volcano'
  | 'caves'
  | 'industrial'
  | 'floating'
  | 'coast'
  | 'fantasy';

/** Things buried in the soil. Each theme picks a few with its own colours. */
export type DetailKind = 'stone' | 'crystal' | 'bone' | 'root' | 'pipe' | 'shell' | 'ember' | 'gear';

export interface DetailSpec {
  kind: DetailKind;
  /** Relative chance against the theme's other details. */
  weight: number;
  /** Fill, outline/shade, highlight. */
  colors: readonly [string, string, string];
}

/** The skyline behind the battlefield, drawn by paintBackground in slugBackdrop.ts. */
export type Horizon = 'islands' | 'hills' | 'mesas' | 'peaks' | 'volcano' | 'cave' | 'city' | 'floaters' | 'cliffs' | 'spires';

/** How the soil body is textured: soft blotches, sediment bands, packed rocks, or poured concrete. */
export type SoilPattern = 'blotch' | 'strata' | 'cobble' | 'plates';

export interface Theme {
  name: string;
  skyTop: string;
  skyBottom: string;
  /** The pale air at the horizon that distant shapes fade into. */
  haze: string;
  /** Null where there is no sky to have clouds in (caves). */
  cloud: string | null;
  cloudShade: string;
  horizon: Horizon;
  /** Background silhouettes, far, middle and near, before the haze is laid over them. */
  hills: readonly [string, string, string];
  water: string;
  waterDeep: string;
  /** Soil tones, dark to light. */
  soil: readonly [string, string, string];
  pattern: SoilPattern;
  speck: string;
  outline: string;
  /** Top edge (grass, snow, sand, ash, moss): body, lit top rows, lower hem. */
  crust: string;
  crustLight: string;
  crustDark: string;
  /** Crust thickness in px on a flat top. */
  crustDepth: number;
  /** Longest blade of grass above the edge, px; 0 for a smooth top. */
  blades: number;
  /** Colour of things hanging under overhangs (icicles, roots, drips); null for none. */
  hang: string | null;
  /** Longest hanging thing, px. */
  hangLength: number;
  /** Rust run from the ties in concrete, layer lines in strata. */
  accent: string;
  scorch: string;
  details: readonly DetailSpec[];
  /** Percent of detail grid cells that hold something. */
  detailChance: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  tropical: {
    name: 'Tropical islands',
    skyTop: '#3f9bd8',
    skyBottom: '#bfe6f0',
    haze: '#d9f1f2',
    cloud: '#ffffff',
    cloudShade: '#d3ebf3',
    horizon: 'islands',
    hills: ['#6fa7b4', '#3f8a7c', '#2f6f55'],
    water: '#2c8db0',
    waterDeep: '#18597a',
    soil: ['#8a5530', '#a66c3b', '#c18649'],
    pattern: 'blotch',
    speck: '#6a3f22',
    outline: '#3a2212',
    crust: '#47a83a',
    crustLight: '#8fd24e',
    crustDark: '#2c7428',
    crustDepth: 6,
    blades: 3,
    hang: '#5d3b20',
    hangLength: 5,
    accent: '#7a4a28',
    scorch: '#2a170c',
    details: [
      { kind: 'shell', weight: 2, colors: ['#d9b896', '#8f6248', '#ead3b8'] },
      { kind: 'stone', weight: 4, colors: ['#a8916f', '#6e5a44', '#c4b190'] },
      { kind: 'root', weight: 3, colors: ['#6b4526', '#3a2212', '#8a6038'] },
    ],
    detailChance: 18,
  },
  countryside: {
    name: 'Green countryside',
    skyTop: '#6aa6dd',
    skyBottom: '#d6e8f1',
    haze: '#e6eef0',
    cloud: '#ffffff',
    cloudShade: '#d7e4ee',
    horizon: 'hills',
    hills: ['#86a9bb', '#6f9e6a', '#4f8a4a'],
    water: '#3d7ea6',
    waterDeep: '#244c70',
    soil: ['#5b3a22', '#71472a', '#875935'],
    pattern: 'blotch',
    speck: '#3c2414',
    outline: '#28190d',
    crust: '#56a538',
    crustLight: '#97cf58',
    crustDark: '#367a28',
    crustDepth: 7,
    blades: 3,
    hang: '#4a2e18',
    hangLength: 6,
    accent: '#4a2e18',
    scorch: '#1f120a',
    details: [
      { kind: 'stone', weight: 5, colors: ['#9b958b', '#57524b', '#c4bfb5'] },
      { kind: 'root', weight: 3, colors: ['#6a4426', '#2e1c0e', '#8c6440'] },
      { kind: 'bone', weight: 1, colors: ['#e9e0c8', '#7a6e58', '#fffaf0'] },
    ],
    detailChance: 30,
  },
  canyon: {
    name: 'Desert canyon',
    skyTop: '#6fb0de',
    skyBottom: '#f0d6aa',
    haze: '#f4dfbd',
    cloud: '#fff8ec',
    cloudShade: '#ecd8bc',
    horizon: 'mesas',
    hills: ['#c99a86', '#c7835a', '#a85f3a'],
    water: '#4a8c9c',
    waterDeep: '#2c5a68',
    soil: ['#a24f2a', '#be6935', '#d6874a'],
    pattern: 'strata',
    speck: '#7a381c',
    outline: '#4a2010',
    crust: '#e5b676',
    crustLight: '#f6d8a2',
    crustDark: '#bf874f',
    crustDepth: 4,
    blades: 0,
    hang: null,
    hangLength: 0,
    accent: '#8a3e1e',
    scorch: '#3a1a0c',
    details: [
      { kind: 'bone', weight: 3, colors: ['#efe4cc', '#8a6e50', '#fffaf0'] },
      { kind: 'shell', weight: 2, colors: ['#e3c59a', '#8a6038', '#f6e4c4'] },
      { kind: 'stone', weight: 3, colors: ['#c9a27a', '#7a5434', '#e6c6a0'] },
    ],
    detailChance: 26,
  },
  snow: {
    name: 'Snowy mountains',
    skyTop: '#8bb6df',
    skyBottom: '#eaf2f7',
    haze: '#f2f6f9',
    cloud: '#ffffff',
    cloudShade: '#dce6ef',
    horizon: 'peaks',
    hills: ['#9fb3c9', '#7f98b2', '#4f6a63'],
    water: '#3a6d8d',
    waterDeep: '#20435c',
    soil: ['#565f6e', '#6a7484', '#808b9b'],
    pattern: 'cobble',
    speck: '#3e4552',
    outline: '#222833',
    crust: '#eef4f9',
    crustLight: '#ffffff',
    crustDark: '#c3d4e3',
    crustDepth: 8,
    blades: 0,
    hang: '#cfe7f4',
    hangLength: 7,
    accent: '#3e4552',
    scorch: '#1c1f26',
    details: [
      { kind: 'crystal', weight: 2, colors: ['#bfe2f2', '#5f8ea8', '#f2fbff'] },
      { kind: 'stone', weight: 3, colors: ['#9aa3ae', '#4c5460', '#c2c9d2'] },
    ],
    detailChance: 22,
  },
  volcano: {
    name: 'Volcanic',
    skyTop: '#3a2a2a',
    skyBottom: '#9a6a58',
    haze: '#c87a4e',
    cloud: '#7a5c52',
    cloudShade: '#5c443d',
    horizon: 'volcano',
    hills: ['#6a4038', '#47302b', '#2e2120'],
    water: '#cc5528',
    waterDeep: '#862611',
    soil: ['#2d292b', '#3b3537', '#4b4345'],
    pattern: 'cobble',
    speck: '#1d191b',
    outline: '#120d0e',
    crust: '#857a74',
    crustLight: '#a99d95',
    crustDark: '#625853',
    crustDepth: 3,
    blades: 0,
    hang: null,
    hangLength: 0,
    accent: '#d8642c',
    scorch: '#0e0a0a',
    details: [
      { kind: 'ember', weight: 3, colors: ['#e8752e', '#7a2410', '#ffd27a'] },
      { kind: 'crystal', weight: 2, colors: ['#25242c', '#0e0d12', '#6a6878'] },
      { kind: 'stone', weight: 2, colors: ['#5a5254', '#221d1e', '#7a7072'] },
    ],
    detailChance: 26,
  },
  caves: {
    name: 'Underground caves',
    skyTop: '#141211',
    skyBottom: '#2e2825',
    haze: '#3c3430',
    cloud: null,
    cloudShade: '#000000',
    horizon: 'cave',
    hills: ['#3a322e', '#2a2421', '#1e1a18'],
    water: '#2d5764',
    waterDeep: '#18333d',
    soil: ['#493e37', '#594c43', '#6a5b4f'],
    pattern: 'cobble',
    speck: '#322a25',
    outline: '#16110f',
    crust: '#5e7a3a',
    crustLight: '#86a150',
    crustDark: '#3e5428',
    crustDepth: 3,
    blades: 1,
    hang: '#6a5b4f',
    hangLength: 8,
    accent: '#322a25',
    scorch: '#100c0a',
    details: [
      { kind: 'crystal', weight: 3, colors: ['#7ccfc4', '#2f6e6a', '#d2f4ee'] },
      { kind: 'bone', weight: 1, colors: ['#ddd2b8', '#6e6250', '#f6efdf'] },
      { kind: 'stone', weight: 2, colors: ['#857466', '#3c322b', '#a39282'] },
    ],
    detailChance: 26,
  },
  industrial: {
    name: 'Industrial',
    skyTop: '#8e989f',
    skyBottom: '#d6cfbf',
    haze: '#d9d2c3',
    cloud: '#bcb8ad',
    cloudShade: '#a19d93',
    horizon: 'city',
    hills: ['#8a9096', '#6a7176', '#4c5256'],
    water: '#4d685c',
    waterDeep: '#2d423a',
    soil: ['#57514d', '#6b645f', '#817870'],
    pattern: 'plates',
    speck: '#3c3835',
    outline: '#1e1b19',
    crust: '#787e84',
    crustLight: '#9ca2a7',
    crustDark: '#53585d',
    crustDepth: 4,
    blades: 0,
    hang: null,
    hangLength: 0,
    accent: '#9a5430',
    scorch: '#151312',
    details: [
      { kind: 'pipe', weight: 3, colors: ['#8b9196', '#3c4044', '#b6bbbf'] },
      { kind: 'gear', weight: 2, colors: ['#9a7a52', '#4a3a26', '#c4a478'] },
      { kind: 'stone', weight: 1, colors: ['#8a847c', '#45403b', '#aaa49c'] },
    ],
    detailChance: 24,
  },
  floating: {
    name: 'Floating islands',
    skyTop: '#7dbde9',
    skyBottom: '#e4f3fb',
    haze: '#eef8fc',
    cloud: '#ffffff',
    cloudShade: '#dbeaf4',
    horizon: 'floaters',
    hills: ['#a6b7c8', '#8a8f9a', '#6e6a66'],
    water: '#5b9dc6',
    waterDeep: '#386c93',
    soil: ['#784430', '#915438', '#a96844'],
    pattern: 'blotch',
    speck: '#55301f',
    outline: '#381c10',
    crust: '#55b446',
    crustLight: '#9fdd6c',
    crustDark: '#348632',
    crustDepth: 6,
    blades: 3,
    hang: '#5a3820',
    hangLength: 9,
    accent: '#55301f',
    scorch: '#24120a',
    details: [
      { kind: 'root', weight: 4, colors: ['#6a4226', '#2e1a0c', '#8a6040'] },
      { kind: 'stone', weight: 3, colors: ['#a8988c', '#5a4c42', '#cabcb0'] },
      { kind: 'crystal', weight: 1, colors: ['#9ccff0', '#4c7ea0', '#e6f6ff'] },
    ],
    detailChance: 28,
  },
  coast: {
    name: 'Coast',
    skyTop: '#78b4dc',
    skyBottom: '#e2eeea',
    haze: '#eef3ee',
    cloud: '#ffffff',
    cloudShade: '#dce8e8',
    horizon: 'cliffs',
    hills: ['#9fb4b4', '#b4b8ae', '#5f6b66'],
    water: '#3884a4',
    waterDeep: '#215876',
    soil: ['#bdb3a0', '#cfc6b4', '#e1dacb'],
    pattern: 'strata',
    speck: '#9c917c',
    outline: '#4a4336',
    crust: '#78a452',
    crustLight: '#a7cb77',
    crustDark: '#547838',
    crustDepth: 5,
    blades: 2,
    hang: null,
    hangLength: 0,
    accent: '#a69b86',
    scorch: '#2e2a22',
    details: [
      { kind: 'stone', weight: 4, colors: ['#4c4c54', '#22222a', '#7a7a86'] },
      { kind: 'shell', weight: 2, colors: ['#e9d2bc', '#94735a', '#fff4e8'] },
    ],
    detailChance: 26,
  },
  fantasy: {
    name: 'Fantasy',
    skyTop: '#4f84ab',
    skyBottom: '#f2c594',
    haze: '#f6d6ae',
    cloud: '#fbe4d2',
    cloudShade: '#e7bba2',
    horizon: 'spires',
    hills: ['#8d9fb4', '#5f8a8f', '#3f6a6e'],
    water: '#378c88',
    waterDeep: '#205e5c',
    soil: ['#3c5864', '#486a76', '#587d88'],
    pattern: 'blotch',
    speck: '#2a404a',
    outline: '#18282e',
    crust: '#dea03e',
    crustLight: '#f4cb6e',
    crustDark: '#ad6e26',
    crustDepth: 5,
    blades: 2,
    hang: '#ad6e26',
    hangLength: 5,
    accent: '#2a404a',
    scorch: '#121c20',
    details: [
      { kind: 'crystal', weight: 4, colors: ['#ef9fae', '#9a4c5c', '#ffe0e6'] },
      { kind: 'shell', weight: 2, colors: ['#e8d8b0', '#8a7448', '#fff6dc'] },
      { kind: 'stone', weight: 2, colors: ['#7f97a0', '#3a4c54', '#a6bcc4'] },
    ],
    detailChance: 28,
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
