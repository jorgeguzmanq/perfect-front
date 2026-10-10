/**
 * Entrada IIFE que el proxy inyecta en el HTML:
 *   <script src="/__pf/overlay.js" data-pf-token="…" data-pf-base="/__pf"></script>
 * Corre en el mundo principal de la página (mismo origen que la API).
 */
import { bootPage } from './boot-core';

const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>('script[data-pf-token]');

bootPage({
  token: script?.getAttribute('data-pf-token') ?? '',
  base: script?.getAttribute('data-pf-base') || '/__pf',
});
