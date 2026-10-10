// Vite: `?inline` devuelve el CSS como string.
declare module '*.css?inline' {
  const css: string;
  export default css;
}
