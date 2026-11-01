// Card the Polkadot App shows for the app (icon, name, description). pad reads it next to dist/.
// domain must match the temporary name passed to pad, so it comes from APP_DOT (polkadot-products-devnet skill, publicar.md §4).
export default {
  domain: process.env.APP_DOT,
  displayName: 'Iris',
  description: 'Remesas de EE. UU. a México en segundos, sin comisión.',
  // png or jpeg only, square (512×512).
  icon: { path: './assets/icon.png', format: 'png' },
  executables: [{ kind: 'app', path: './dist', appVersion: [1, 0, 0] }],
};
