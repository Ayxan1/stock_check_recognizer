const API_URL =
  "http://localhost:8000/api/inventory/inventory-items/add-or-update/";

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
