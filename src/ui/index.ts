/** The design system: tokens + components (CSS), the own icon set, wavy progress, the morphing loader and the page kit. Import `./ui.css` once per page. */
export { Icon, type IconName } from './icons.tsx';
export { WavyProgress, Loader } from './progress.tsx';
export * from './kit.tsx';
export { applyTheme, readTheme, type Theme } from './theme.ts';
