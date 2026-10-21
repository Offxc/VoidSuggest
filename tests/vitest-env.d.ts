// Vite's `import.meta.glob`, used by the access-matrix test to find every route file.
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}
