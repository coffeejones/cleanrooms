// Pinned first-party delivery; no executable dependency is loaded from a CDN.
import * as lucide from 'lucide';
import * as FloatingUIDOM from '@floating-ui/dom';
// The previous UMD build supplied its icon map implicitly; the ESM API requires
// it explicitly. Retain the existing createIcons({attrs}) call contract.
globalThis.lucide = { ...lucide, createIcons: (options = {}) => lucide.createIcons({ ...options, icons: options.icons ?? lucide.icons }) };
globalThis.FloatingUIDOM = FloatingUIDOM;
