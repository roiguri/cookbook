export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface MobileTheme {
  colors: {
    primaryDark: string;
    primary: string;
    primaryBright: string;
    neutral: string;
    secondary: string;
    secondaryLight: string;
    secondaryDark: string;
    caution: string;
    surface0: string;
    surface1: string;
    surface2: string;
    ink: string;
    ink2: string;
    ink3: string;
    ink4: string;
    hairline: string;
    hairlineStrong: string;
    pressTint: string;
    focusRing: string;
    buttonColor: string;
  };
  semantic: {
    primaryColor: string;
    primaryHover: string;
    bg: string;
    cardBg: string;
    textColor: string;
    textStrong: string;
    textMuted: string;
    buttonColor: string;
  };
  fonts: {
    display: string;
    displayHe: string;
    displayHeBold: string;
    ui: string;
    uiMedium: string;
    uiSemiBold: string;
    uiHe: string;
    uiHeMedium: string;
    uiHeBold: string;
    mono: string;
  };
  typeScale: {
    stepMinus1: number;
    step0: number;
    step1: number;
    step2: number;
    step3: number;
    step4: number;
    step5: number;
    step6: number;
  };
  radii: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    '2xl': number;
    pill: number;
  };
  motion: {
    dur1: number;
    dur2: number;
    dur3: number;
    ease: [number, number, number, number];
    easeOut: [number, number, number, number];
  };
  press: {
    scale: number;
    scaleIcon: number;
    scaleCard: number;
    tint: string;
  };
  layout: {
    contentMax: number;
    gutter: number;
  };
  zIndex: {
    hide: number;
    base: number;
    elevated: number;
    sticky: number;
    pageOverlay: number;
    nav: number;
    backdrop: number;
    drawer: number;
    modal: number;
    toast: number;
    fullscreen: number;
    spinner: number;
  };
  shadows: {
    level1: ShadowStyle;
    level2: ShadowStyle;
    level3: ShadowStyle;
  };
}

export declare const cssVariables: Readonly<Record<string, string>>;
export declare const mobileTheme: Readonly<MobileTheme>;
export declare const colors: Readonly<MobileTheme['colors']>;
export declare const semantic: Readonly<MobileTheme['semantic']>;
export declare const fonts: Readonly<MobileTheme['fonts']>;
export declare const typeScale: Readonly<MobileTheme['typeScale']>;
export declare const radii: Readonly<MobileTheme['radii']>;
export declare const motion: Readonly<MobileTheme['motion']>;
export declare const press: Readonly<MobileTheme['press']>;
export declare const layout: Readonly<MobileTheme['layout']>;
export declare const zIndex: Readonly<MobileTheme['zIndex']>;
export declare const shadows: Readonly<MobileTheme['shadows']>;
export default mobileTheme;
