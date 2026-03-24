const API_URL =
  "http://localhost:8000/api/inventory/inventory-items/add-or-update/";

/**
 * Normalize unit and quantity to kg if it's a weight unit
 */
function normalizeWeight(quantity, unitRaw) {
  const u = unitRaw.toLowerCase().trim();

  if (u === "qr" || u === "qram" || u === "gr" || u === "g") {
    return { quantity: quantity / 1000, unit: "kg" };
  }
  if (u === "ton" || u === "t") {
    return { quantity: quantity * 1000, unit: "kg" };
  }
  if (u === "kq" || u === "kq." || u === "kg") {
    return { quantity, unit: "kg" };
  }
  if (u === "pcs" || u === "əd" || u === "ədəd" || u === "ed") {
    return { quantity, unit: "pcs" };
  }

  // Default: pcs
  return { quantity, unit: "pcs" };
}

/**
 * Parse items from Gemini table response
 */
function parseItems(geminiResponse) {
  const items = [];
  const lines = geminiResponse.split("\n");

  for (const line of lines) {
    if (
      line.includes("|") &&
      !line.toLowerCase().includes("məhsul") &&
      !line.includes("---")
    ) {
      const parts = line
        .split("|")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      if (parts.length >= 4) {
        const name = parts[0];

        let quantityRaw = parts[1].replace(/[^\d.,]/g, "").replace(",", ".");
        const quantityParsed = parseFloat(quantityRaw) || 1;

        const unitRaw = parts[2].trim();

        // Normalize weight units → always produce kg or pcs
        const { quantity, unit } = normalizeWeight(quantityParsed, unitRaw);

        let priceRaw = parts[3].replace(/[^\d.,]/g, "").replace(",", ".");
        const price = parseFloat(priceRaw) || 0;

        items.push({ name, category: 1, unit, supplier: 1, price, quantity });
      }
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
