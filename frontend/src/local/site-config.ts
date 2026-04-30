/**
 * Build-time site configuration for the per-instance legal pages
 * (Impressum / Datenschutz). All values come from `VITE_*` env vars,
 * resolved by Vite at build-time (or by Vitest at runtime in tests).
 *
 * `null` for a section = "not configured". The page then renders a
 * placeholder instead of partial / missing details, so the operator
 * notices before the public ever does.
 */

export interface ImprintConfig {
  name: string;
  addressLine1: string;
  addressLine2: string;
  country: string;
  email: string;
}

export interface DsgvoAuthority {
  name: string;
  address: string;
}

export interface SiteConfig {
  imprint: ImprintConfig | null;
  authority: DsgvoAuthority | null;
}

function read(key: string): string | null {
  const env = (import.meta.env as Record<string, unknown>)[key];
  if (typeof env !== "string") return null;
  const trimmed = env.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getSiteConfig(): SiteConfig {
  const name = read("VITE_IMPRESSUM_NAME");
  const addressLine1 = read("VITE_IMPRESSUM_ADDRESS_LINE_1");
  const addressLine2 = read("VITE_IMPRESSUM_ADDRESS_LINE_2");
  const country = read("VITE_IMPRESSUM_COUNTRY");
  const email = read("VITE_IMPRESSUM_EMAIL");

  // Imprint requires the legally mandatory fields. Country is recommended
  // but not strictly required to render; it stays a nullable display field.
  const imprint: ImprintConfig | null =
    name && addressLine1 && addressLine2 && email
      ? { name, addressLine1, addressLine2, country: country ?? "", email }
      : null;

  const authorityName = read("VITE_DSGVO_AUTHORITY_NAME");
  const authority: DsgvoAuthority | null = authorityName
    ? {
        name: authorityName,
        address: read("VITE_DSGVO_AUTHORITY_ADDRESS") ?? "",
      }
    : null;

  return { imprint, authority };
}
