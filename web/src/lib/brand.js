// customer.config brand colours -> CSS tokens, as a stylesheet text (never inline styles). The server has already validated the
// colours (#rrggbb, no purple, contrast); this only writes them into the token names the shared stylesheet uses (--accent, --on-accent and the
// --accent-gradient the primary buttons draw with).
const HEX = /^#[0-9a-f]{6}$/;
export function brandCss(brand) {
  if (!brand) return "";
  const ok = (v) => typeof v === "string" && HEX.test(v);
  const light = ok(brand.primary) && ok(brand.onPrimary) ? `--accent:${brand.primary};--on-accent:${brand.onPrimary};--accent-gradient:${brand.primary};` : "";
  const dark = ok(brand.primaryDark) && ok(brand.onPrimaryDark) ? `--accent:${brand.primaryDark};--on-accent:${brand.onPrimaryDark};--accent-gradient:${brand.primaryDark};` : "";
  return [
    light && `:root{${light}}`,
    dark && `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}`,
    dark && `:root[data-theme="dark"]{${dark}}`,
    light && `:root[data-theme="light"]{${light}}`,
  ].filter(Boolean).join("\n");
}
