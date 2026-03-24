const API_URL      = "http://localhost:8000/api/inventory/inventory-items/add-or-update/";
const API_LIST_URL = "http://localhost:8000/api/inventory/inventory-items/";

/**
 * Transliterate Azerbaijani / Turkish special characters to ASCII equivalents,
 * then trim surrounding whitespace and replace inner spaces with hyphens.
 *
 * Examples:
 *   "  DUYU GULNAR  "          → "DUYU-GULNAR"
 *   "T.Biber SALÇA-BİZİM"      → "T.Biber-SALCA-BIZIM"
 *   "Sosiska Səhər 1kq"        → "Sosiska-Seher-1kq"
 *
 * @param {string} name
 * @returns {string}
 */
function slugifyName(name) {
  const MAP = {
    ə: "e", Ə: "E",
    ö: "o", Ö: "O",
    ü: "u", Ü: "U",
    ğ: "g", Ğ: "G",
    ı: "i", İ: "I",
    ş: "s", Ş: "S",
    ç: "c", Ç: "C",
    â: "a", Â: "A",
    î: "i", Î: "I",
    û: "u", Û: "U",
  };

  return name
    .replace(/[əƏöÖüÜğĞıİşŞçÇâÂîÎûÛ]/g, (ch) => MAP[ch] || ch)
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Normalise a unit string coming from the check's Ölçü vahidi column.
 * Accepts: kq, kg, g, qr, gr, qram, ton, eded, əd, ədəd, ed, pcs, l, litr, ml
 *
 * @param {string} rawUnit
 * @returns {string} canonical unit: "kg" | "g" | "l" | "ml" | "pcs"
 */
function normaliseUnit(rawUnit) {
  const u = (rawUnit || "").toLowerCase().trim().replace(/\.$/, "");

  if (u === "kq" || u === "kg")                         return "kg";
  if (u === "g"  || u === "qr" || u === "gr" || u === "qram") return "g";
  if (u === "ton" || u === "t")                         return "kg"; // treat ton as kg (value already large)
  if (u === "l"  || u === "litr")                       return "l";
  if (u === "ml")                                       return "ml";

  // eded, əd, ədəd, ed, pcs, or anything else → piece-based
  return "pcs";
}

/**
 * Build a stable fingerprint for a product name so that OCR/Gemini variants
 * of the same product collapse to the same key.
 *
 * Steps:
 *   1. Lowercase
 *   2. Transliterate special chars (reuses the same MAP as slugifyName)
 *   3. Strip everything that is NOT a letter or digit (spaces, hyphens,
 *      asterisks, dots, backslashes, …)
 *   4. Split into individual tokens, sort them, rejoin
 *
 * Examples — all produce the same fingerprint "012fruktoviyltportagalsad":
 *   "Fruktoviy Sad Portagal 0.95 lt*12"
 *   "Fruktoviy Sad Portağal 0.95 lt*12"   ← ğ → g
 *   "Fruktoviy-Sad-Portagal-0.95-lt*12"   ← hyphens stripped
 *   "Fruktoviy-Sad-Portagal-0.95-lt\*12"  ← backslash stripped
 *
 * @param {string} name
 * @returns {string}
 */
function fingerprint(name) {
  const MAP = {
    ə:"e",Ə:"E",ö:"o",Ö:"O",ü:"u",Ü:"U",
    ğ:"g",Ğ:"G",ı:"i",İ:"I",ş:"s",Ş:"S",
    ç:"c",Ç:"C",â:"a",Â:"A",î:"i",Î:"I",û:"u",Û:"U",
  };
  const transliterated = name
    .replace(/[əƏöÖüÜğĞıİşŞçÇâÂîÎûÛ]/g, (ch) => MAP[ch] || ch)
    .toLowerCase();

  // Keep only alphanumeric chars, split on everything else, sort, join
  const tokens = transliterated
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort();

  return tokens.join("");
}

/**
 * Fetch all existing inventory items from the API.
 * Returns an array of { id, name, unit } objects, or [] on failure.
 */
async function fetchExistingItems() {
  try {
    const res = await fetch(API_LIST_URL);
    if (!res.ok) {
      console.warn(`⚠️ Could not fetch inventory list (${res.status}), skipping fuzzy match`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn("⚠️ Network error fetching inventory list:", err.message);
    return [];
  }
}

/**
 * Compute Dice-coefficient similarity between two fingerprint strings.
 * Returns a value between 0 (nothing in common) and 1 (identical).
 * Works on bigrams of the fingerprint string.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function diceSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
  };

  const aMap = bigrams(a);
  const bMap = bigrams(b);
  let intersection = 0;

  for (const [bg, count] of aMap) {
    if (bMap.has(bg)) intersection += Math.min(count, bMap.get(bg));
  }

  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

/**
 * Given a new item name and the list of existing inventory items,
 * return the best-matching existing name if similarity ≥ threshold,
 * otherwise return null.
 *
 * @param {string} newName - already slugified new name
 * @param {{ id: number, name: string, unit: string }[]} existingItems
 * @param {number} threshold - minimum similarity (0–1), default 0.85
 * @returns {string|null} matched existing name, or null
 */
function findBestMatch(newName, existingItems, threshold = 0.85) {
  const fpNew = fingerprint(newName);
  let bestScore = 0;
  let bestName  = null;

  for (const item of existingItems) {
    const fpExisting = fingerprint(item.name);
    const score = diceSimilarity(fpNew, fpExisting);
    if (score > bestScore) {
      bestScore = score;
      bestName  = item.name;
    }
  }

  if (bestScore >= threshold) {
    console.log(`🔍 Matched "${newName}" → "${bestName}" (score: ${(bestScore * 100).toFixed(1)}%)`);
    return bestName;
  }

  return null;
}

/**
 * Parse items from Gemini table response.
 * Gemini returns 4 columns: Məhsul | Miqdar | Vahid | Cəm
 * Falls back gracefully to 3-column legacy format.
 */
function parseItems(geminiResponse) {
  const items = [];
  const lines = geminiResponse.split("\n");

  for (const line of lines) {
    if (
      line.includes("|") &&
      !line.toLowerCase().includes("məhsul") &&
      !line.toLowerCase().includes("miqdar") &&
      !line.toLowerCase().includes("say") &&
      !line.includes("---")
    ) {
      const parts = line
        .split("|")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      let name, quantity, unit, totalPrice;

      if (parts.length >= 4) {
        // New 4-column format: Məhsul | Miqdar | Vahid | Cəm
        name       = parts[0];
        quantity   = parseFloat(parts[1].replace(",", ".")) || 1;
        unit       = normaliseUnit(parts[2]);
        totalPrice = parseFloat(parts[3].replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      } else if (parts.length === 3) {
        // Legacy 3-column format: Məhsul | Say | Cəm — default to pcs
        name       = parts[0];
        quantity   = parseFloat(parts[1].replace(",", ".")) || 1;
        unit       = "pcs";
        totalPrice = parseFloat(parts[2].replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      } else {
        continue;
      }

      // name will be resolved against the API list in sendItemsToApi
      items.push({ name: slugifyName(name), category: 1, unit, supplier: 1, price: totalPrice, quantity });
    }
  }

  return items;
}

/**
 * Send all parsed items to localhost:8000 API
 * Returns a summary message of results
 */
export async function sendItemsToApi(geminiResponse) {
  const items = parseItems(geminiResponse);
  if (items.length === 0) return null;

  // Fetch existing inventory once for the whole batch
  const existingItems = await fetchExistingItems();

  // Resolve each item name: use existing API name if ≥85% similar, else keep new slug
  for (const item of items) {
    const match = findBestMatch(item.name, existingItems);
    if (match) item.name = match;
  }

  const results = { success: [], failed: [] };

  for (const item of items) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });

      if (response.ok) {
        console.log(`✅ API: Sent "${item.name}" → ${response.status}`);
        results.success.push(item.name);
      } else {
        const errorText = await response.text();
        console.error(
          `❌ API: Failed "${item.name}" → ${response.status}: ${errorText}`,
        );
        results.failed.push(`${item.name} (${response.status})`);
      }
    } catch (err) {
      console.error(`❌ API: Network error for "${item.name}":`, err.message);
      results.failed.push(`${item.name} (network error)`);
    }
  }

  let summary = `📡 *API Nəticəsi (localhost:8000)*\n`;
  summary += `✅ Uğurlu: ${results.success.length}/${items.length}\n`;
  if (results.success.length > 0) {
    summary += results.success.map((n) => `  • ${n}`).join("\n") + "\n";
  }
  if (results.failed.length > 0) {
    summary += `❌ Uğursuz:\n`;
    summary += results.failed.map((n) => `  • ${n}`).join("\n");
  }

  return summary;
}

/**
 * Legacy: generate curl commands as text (kept for reference)
 */
export function generateCurlForItems(geminiResponse) {
  const items = parseItems(geminiResponse);
  if (items.length === 0) return null;

  const curls = items.map(
    (item) =>
      `curl --location '${API_URL}' \\\n--header 'Content-Type: application/json' \\\n--data '${JSON.stringify(item, null, 2)}'`,
  );

  return `Budur məhsullar üçün API sorğuları:\n\n${curls.join("\n\n")}`;
}
