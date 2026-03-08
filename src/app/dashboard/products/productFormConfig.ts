export const PRODUCT_CATEGORY_OPTIONS = [
  "Doors",
  "Windows",
  "Enclosures",
  "Casement",
  "Sliding",
  "Railings",
  "Canopy",
  "Curtain Wall",
] as const;

export const PRODUCT_FEATURE_PRESETS: Record<string, string[]> = {
  Doors: [
    "Tempered safety glass",
    "Heavy-duty aluminum frame",
    "Soft-close operation",
    "Multi-point locking system",
    "Weather-resistant seals",
    "Low-maintenance finish",
  ],
  Windows: [
    "Tempered safety glass",
    "Powder-coated aluminum frame",
    "Smooth sliding rollers",
    "Weather-resistant seals",
    "Energy-efficient glazing",
    "Easy-clean design",
  ],
  Enclosures: [
    "Frameless tempered glass panels",
    "Stainless steel hardware",
    "Water-tight seals",
    "Corrosion-resistant finish",
    "Easy-clean glass surface",
    "Modern minimalist profile",
  ],
  Casement: [
    "Side-hinged opening",
    "Smooth crank operation",
    "Weather-tight locking system",
    "Tempered safety glass",
    "Powder-coated frame",
    "Wide ventilation opening",
  ],
  Sliding: [
    "Space-saving sliding panels",
    "Heavy-duty roller system",
    "Tempered safety glass",
    "Slim aluminum frame",
    "Quiet glide track",
    "Secure lock mechanism",
  ],
  Railings: [
    "Tempered safety glass panels",
    "Stainless steel handrail",
    "Corrosion-resistant hardware",
    "Modern minimalist look",
    "Secure mounting brackets",
    "Low-maintenance finish",
  ],
  Canopy: [
    "Durable polycarbonate or glass cover",
    "Powder-coated support frame",
    "UV-resistant protection",
    "Rainwater runoff design",
    "Corrosion-resistant hardware",
    "Modern exterior profile",
  ],
  "Curtain Wall": [
    "High-performance glazing",
    "Structural aluminum framing",
    "Thermal insulation support",
    "Weather-tight sealing system",
    "Modern facade appearance",
    "Low-maintenance exterior finish",
  ],
};

export const PRODUCT_FORM_TABS = [
  {
    key: "identity",
    label: "Basic Info",
    description: "Product code, name, and description",
  },
  {
    key: "classification",
    label: "Category",
    description: "Category and additional features",
  },
  {
    key: "details",
    label: "Details",
    description: "Pricing, stock, and dimensions",
  },
  {
    key: "files",
    label: "Files",
    description: "Images, 3D models, and skyboxes",
  },
] as const;

export type ProductFormTabKey = (typeof PRODUCT_FORM_TABS)[number]["key"];

export function getCategoryFeatureOptions(category?: string | null): string[] {
  return PRODUCT_FEATURE_PRESETS[String(category || "")] ?? [];
}

export function createFeatureOptionsByCategory(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(PRODUCT_FEATURE_PRESETS).map(([category, options]) => [category, [...options]])
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function stripRichText(value: string | null | undefined): string {
  if (!value) return "";
  return decodeHtmlEntities(
    String(value)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/ul>/gi, "\n")
      .replace(/<\/ol>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeFeatureKey(value: string): string {
  return stripRichText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function mergeFeatureOptions(existing: string[] = [], additions: string[] = []): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  [...existing, ...additions]
    .map((item) => stripRichText(item).replace(/^[•\-\*\s]+/, "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = normalizeFeatureKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });

  return merged;
}

export function parseFeatureItems(value: string | null | undefined): string[] {
  const plainText = stripRichText(value);
  if (!plainText) return [];

  const seen = new Set<string>();
  const items: string[] = [];

  plainText
    .split(/\n+/)
    .map((item) => item.replace(/^[•\-\*\s]+/, "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = normalizeFeatureKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push(item);
    });

  return items;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildAdditionalFeaturesHtml(selected: string[], customText?: string): string {
  const combined = [...selected, ...parseFeatureItems(customText)];
  const seen = new Set<string>();
  const uniqueItems = combined.filter((item) => {
    const key = normalizeFeatureKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!uniqueItems.length) return "";

  return `<ul>${uniqueItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function getFeatureSelectionFromValue(category: string | null | undefined, value: string | null | undefined) {
  const options = getCategoryFeatureOptions(category);
  const optionMap = new Map(options.map((option) => [normalizeFeatureKey(option), option]));

  const selected: string[] = [];
  const custom: string[] = [];

  parseFeatureItems(value).forEach((item) => {
    const key = normalizeFeatureKey(item);
    const preset = optionMap.get(key);
    if (preset) {
      selected.push(preset);
      return;
    }
    custom.push(item);
  });

  return {
    selected,
    custom: custom.join("\n"),
  };
}
