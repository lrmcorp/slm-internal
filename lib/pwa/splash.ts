/** Ukuran layar iPhone (titik CSS × skala) untuk splash screen layar utama, potret. */
export const IPHONE_SPLASH_SCREENS = [
  { w: 440, h: 956, r: 3 }, // 16 Pro Max
  { w: 402, h: 874, r: 3 }, // 16 Pro
  { w: 430, h: 932, r: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { w: 393, h: 852, r: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 428, h: 926, r: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 390, h: 844, r: 3 }, // 12, 13, 14
  { w: 375, h: 812, r: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 414, h: 896, r: 3 }, // XS Max, 11 Pro Max
  { w: 414, h: 896, r: 2 }, // XR, 11
  { w: 414, h: 736, r: 3 }, // 6/7/8 Plus
  { w: 375, h: 667, r: 2 }, // SE, 6/7/8
] as const;

export const splashKey = (s: { w: number; h: number; r: number }) => `${s.w * s.r}x${s.h * s.r}`;

export function iphoneStartupImages() {
  return IPHONE_SPLASH_SCREENS.map((s) => ({
    url: `/pwa-splash/${splashKey(s)}`,
    media: `(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.r}) and (orientation: portrait)`,
  }));
}
