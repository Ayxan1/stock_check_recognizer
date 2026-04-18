const API_URL = "http://localhost:8000/api/inventory/inventory-items/add-or-update/";
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
    ə: "e",
    Ə: "E",
    ö: "o",
    Ö: "O",
    ü: "u",
    Ü: "U",
    ğ: "g",
    Ğ: "G",
    ı: "i",
    İ: "I",
    ş: "s",
    Ş: "S",
    ç: "c",
    Ç: "C",
    â: "a",
    Â: "A",
    î: "i",
    Î: "I",
    û: "u",
    Û: "U",
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

  if (u === "kq" || u === "kg") return "kg";
  if (u === "g" || u === "qr" || u === "gr" || u === "qram") return "g";
  if (u === "ton" || u === "t") return "kg"; // treat ton as kg (value already large)
  if (u === "l" || u === "litr") return "l";
  if (u === "ml") return "ml";

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
    ə: "e",
    Ə: "E",
    ö: "o",
    Ö: "O",
    ü: "u",
    Ü: "U",
    ğ: "g",
    Ğ: "G",
    ı: "i",
    İ: "I",
    ş: "s",
    Ş: "S",
    ç: "c",
    Ç: "C",
    â: "a",
    Â: "A",
    î: "i",
    Î: "I",
    û: "u",
    Û: "U",
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
  let bestName = null;

  for (const item of existingItems) {
    const fpExisting = fingerprint(item.name);
    const score = diceSimilarity(fpNew, fpExisting);
    if (score > bestScore) {
      bestScore = score;
      bestName = item.name;
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
 * Gemini returns 4 columns: Məhsul | Miqdar | Vahid | Vahid Qiymət
 * The 4th column is already the unit price (price per 1 unit/kg/l).
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
      !line.toLowerCase().includes("vahid qiymət") &&
      !line.includes("---")
    ) {
      const parts = line
        .split("|")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      let name, quantity, unit, unitPrice;

      if (parts.length >= 4) {
        // 4-column format: Məhsul | Miqdar | Vahid | Vahid Qiymət (unit price)
        name = parts[0];
        quantity = parseFloat(parts[1].replace(",", ".")) || 1;
        unit = normaliseUnit(parts[2]);
        unitPrice = parseFloat(parts[3].replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      } else if (parts.length === 3) {
        // Legacy 3-column format: Məhsul | Say | Qiymət — default to pcs
        name = parts[0];
        quantity = parseFloat(parts[1].replace(",", ".")) || 1;
        unit = "pcs";
        unitPrice = parseFloat(parts[2].replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
      } else {
        continue;
      }

      items.push({
        name: slugifyName(name),
        category: 1,
        unit,
        supplier: 1,
        price: unitPrice,
        quantity
      });
    }
  }

  return items;
}

/**
 * Parse a free-form text receipt where each line looks like:
 *   <item name> <quantity+unit> <price> [manat|azn]
 *
 * Rules:
 *   - Price  = rightmost standalone number (optionally followed by manat/azn)
 *   - Qty+unit = rightmost token of the form  <number><unit>  OR  just <number>
 *                before the price token
 *     Units recognised: kg, kq, g, qr, gr, qram, l, litr, ml, pcs, eded, əd
 *     If no unit → quantity is the number, unit = "pcs"
 *     gram-based units (g/qr/gr/qram) are stored as kg (÷1000)
 *   - Everything to the left = item name
 *   - Unit price = totalPrice / quantity
 *
 * Examples:
 *   "xlor 3kg 300 manat"        → name=xlor,      qty=3,    unit=kg,  price=100
 *   "sosiska 300gr 400 manat"   → name=sosiska,   qty=0.3,  unit=kg,  price=1333.33
 *   "pepsi 05 sok 12 12 manat"  → name=pepsi-05-sok, qty=12, unit=pcs, price=1
 *   "sut 2l 5 manat"            → name=sut,        qty=2,   unit=l,   price=2.5
 *
 * @param {string} text - multi-line WhatsApp message
 * @returns {{ name:string, category:number, unit:string, supplier:number, price:number, quantity:number }[]}
 */
export function parseTextReceipt(text) {
  // Strip invisible Unicode characters (zero-width spaces, joiners, BOM, soft-hyphen)
  // that WhatsApp mobile keyboards can inject into messages.
  const cleanText = text.replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "");

  // Token: number glued to a weight/volume unit  e.g. "3kg", "300gr", "0.5l", "2kq"
  const QTY_UNIT_RE = /^(\d+(?:[.,]\d+)?)(kg|kq|g|qr|gr|qram|l|litr|ml|pcs|eded|əd|ədəd)\.?$/i;

  // Price token: a number optionally glued to ANY currency-like suffix
  // Covers: "300", "13.5man", "300manat", "12azn", "450m", "450₼", "450 manat"
  const PRICE_TOKEN_RE = /^(\d+(?:[.,]\d+)?)(manat|man|azn|m|₼)?\.?$/i;

  // Pure currency words to skip when searching for price number
  const SKIP_WORDS = new Set(["manat", "azn", "man", "m", "₼"]);

  // A token that is ONLY a unit word (should never be mistaken for a price)
  const UNIT_ONLY_RE = /^(kg|kq|g|qr|gr|qram|l|litr|ml|pcs|eded|əd|ədəd)\.?$/i;

  const items = [];

  for (const rawLine of cleanText.split("\n")) {
    // Strip WhatsApp-style timestamp prefixes like "[25.03.26, 16:19:05] Name: "
    // Also strip pipe separators from the numbered display format (e.g. "| 1kg | 3 manat")
    const line = rawLine
      .replace(/^\[.*?\]\s*[^:]+:\s*/, "")
      .replace(/\s*\|\s*/g, " ")
      .trim();
    if (!line) continue;

    // Tokenise on whitespace; also strip trailing punctuation from each token
    const tokens = line.split(/\s+/).map((t) => t.replace(/[,;]+$/, ""));
    if (tokens.length < 2) continue;

    // ── 1. Find price ────────────────────────────────────────────────────────
    // Rightmost token that looks like a number (with optional currency suffix).
    // Skip pure currency words and pure unit words.
    let priceIdx = -1;
    let totalPrice = 0;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (SKIP_WORDS.has(t.toLowerCase())) continue;
      if (UNIT_ONLY_RE.test(t)) continue;
      if (QTY_UNIT_RE.test(t)) continue; // qty token, not a price

      const pm = t.match(PRICE_TOKEN_RE);
      if (pm) {
        priceIdx = i;
        totalPrice = parseFloat(pm[1].replace(",", "."));
        break;
      }
    }
    if (priceIdx < 0 || totalPrice <= 0) continue;

    // ── 2. Find quantity + unit ───────────────────────────────────────────────
    // Search rightward-to-left before the price token.
    let qtyIdx = -1;
    let quantity = 0;
    let unit = "pcs";

    for (let i = priceIdx - 1; i >= 0; i--) {
      const t = tokens[i];

      // Case A: number glued to unit  e.g. "3kg", "300gr"
      const quMatch = t.match(QTY_UNIT_RE);
      if (quMatch) {
        const val = parseFloat(quMatch[1].replace(",", "."));
        const rawUnit = quMatch[2].toLowerCase();

        if (rawUnit === "g" || rawUnit === "qr" || rawUnit === "gr" || rawUnit === "qram") {
          quantity = parseFloat((val / 1000).toFixed(4));
          unit = "kg";
        } else {
          quantity = val;
          unit = normaliseUnit(rawUnit);
        }
        qtyIdx = i;
        break;
      }

      // Case B: bare number followed immediately by a unit word as separate token
      //   e.g. "30 kg"  →  tokens[i]="30", tokens[i+1]="kg"
      const bareMatch = t.match(/^(\d+(?:[.,]\d+)?)\.?$/);
      if (bareMatch && i + 1 < priceIdx) {
        const nextToken = tokens[i + 1];
        const unitMatch = nextToken.match(UNIT_ONLY_RE);
        if (unitMatch) {
          const val = parseFloat(bareMatch[1].replace(",", "."));
          const rawUnit = unitMatch[0].toLowerCase().replace(/\.$/, "");
          if (rawUnit === "g" || rawUnit === "qr" || rawUnit === "gr" || rawUnit === "qram") {
            quantity = parseFloat((val / 1000).toFixed(4));
            unit = "kg";
          } else {
            quantity = val;
            unit = normaliseUnit(rawUnit);
          }
          qtyIdx = i; // name ends before i; i+1 is the unit word (skip it in name)
          break;
        }
      }

      // Case C: bare number directly before price → count (pcs)
      if (bareMatch && i === priceIdx - 1) {
        quantity = parseFloat(bareMatch[1].replace(",", "."));
        unit = "pcs";
        qtyIdx = i;
        break;
      }
    }

    if (qtyIdx < 0 || quantity <= 0) continue;

    // ── 3. Item name = tokens before the qty token ────────────────────────────
    // If Case B (separate unit word), skip tokens[qtyIdx+1] from the name too.
    const unitIsNextToken =
      qtyIdx + 1 < priceIdx && UNIT_ONLY_RE.test(tokens[qtyIdx + 1]);
    const nameEnd = unitIsNextToken ? qtyIdx : qtyIdx; // same index; name = [0, qtyIdx)
    const nameParts = tokens.slice(0, nameEnd);
    if (nameParts.length === 0) continue;

    // ── 4. Unit price ─────────────────────────────────────────────────────────
    const unitPrice = parseFloat((totalPrice / quantity).toFixed(4));

    items.push({
      name: slugifyName(nameParts.join(" ")),
      category: 1,
      unit,
      supplier: 1,
      price: unitPrice,
      quantity,
    });
  }

  return items;
}

/**
 * Detect whether a plain-text message looks like a text receipt.
 * Requires at least one line that has a price-like number (optionally followed
 * by manat/azn) and a quantity/unit somewhere before it.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isTextReceipt(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  // A line qualifies if it contains a price token (number optionally glued to
  // any currency suffix incl. short "m") AND either a qty+unit token OR two numbers
  const PRICE_RE = /\d+(?:[.,]\d+)?(manat|man|azn|m|₼)?(\s|$)/i;
  const QTY_UNIT_RE = /\d+(?:[.,]\d+)?\s*(kg|kq|g|qr|gr|qram|l|litr|ml|pcs|eded)/i;
  const TWO_NUMS_RE = /\d+\S*\s+\S*\d+/;

  let qualifyingLines = 0;
  for (const line of lines) {
    if (PRICE_RE.test(line) && (QTY_UNIT_RE.test(line) || TWO_NUMS_RE.test(line))) {
      qualifyingLines++;
    }
  }
  // At least half the non-empty lines must qualify (handles mixed messages)
  return qualifyingLines > 0 && qualifyingLines >= Math.ceil(lines.length / 2);
}

/**
 * Send parsed text-receipt items to the API (same pipeline as image receipts).
 * Fetches existing inventory, fuzzy-matches names, then POSTs each item.
 *
 * @param {string} text - raw WhatsApp text message
 * @returns {Promise<string|null>} summary message
 */
export async function sendTextReceiptToApi(text) {
  const items = parseTextReceipt(text);
  if (items.length === 0) return null;

  // Fetch existing inventory once for the whole batch
  const existingItems = await fetchExistingItems();

  // Resolve each item name against the API inventory (same fuzzy logic)
  for (const item of items) {
    const match = findBestMatch(item.name, existingItems);
    if (match) item.name = match;
  }

  const results = {
    success: [],
    failed: []
  };

  for (const item of items) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(item),
      });

      if (response.ok) {
        console.log(`✅ API: Sent "${item.name}" → ${response.status}`);
        results.success.push(`${item.name} (${item.quantity} ${item.unit} @ ${item.price})`);
      } else {
        const errorText = await response.text();
        console.error(`❌ API: Failed "${item.name}" → ${response.status}: ${errorText}`);
        results.failed.push(`${item.name} (${response.status})`);
      }
    } catch (err) {
      console.error(`❌ API: Network error for "${item.name}":`, err.message);
      results.failed.push(`${item.name} (network error)`);
    }
  }

  let summary = `📝 *Mətn Qəbzi — API Nəticəsi*\n`;
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
 * Send all parsed image-receipt items to localhost:8000 API.
 * Returns a summary message of results.
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

  const results = {
    success: [],
    failed: []
  };

  for (const item of items) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
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
 * Convert a list of parsed items back into the editable text receipt format
 * that parseTextReceipt() can parse again.
 *
 * Each line:
 *   <name (spaces restored from hyphens)> <quantity><unit> <price*qty> manat
 *
 * Examples:
 *   { name:"xlor", qty:3, unit:"kg", price:100 }
 *     → "xlor 3kg 300 manat"
 *   { name:"Fruktoviy-Sad-Portagal", qty:12, unit:"pcs", price:1 }
 *     → "Fruktoviy Sad Portagal 12 12 manat"
 *   { name:"sosiska-seher", qty:0.3, unit:"kg", price:1333.3333 }
 *     → "sosiska seher 300gr 400 manat"
 *
 * @param {{ name:string, unit:string, price:number, quantity:number }[]} items
 * @returns {string}
 */
/**
 * Build the qty+unit display string for one item.
 * pcs items show the explicit "pcs" suffix so the user knows what to type when editing.
 */
function fmtQtyUnit(item) {
  const qty = item.quantity;
  switch (item.unit) {
    case "kg":
      return qty < 1 ?
        `${Math.round(qty * 1000)}gr` :
        `${qty}kg`;
    case "g":
      return `${qty}g`;
    case "l":
      return `${qty}l`;
    case "ml":
      return `${qty}ml`;
    default:
      return `${qty}pcs`; // explicit "pcs" — parseable and clear
  }
}

/**
 * Format a single item as the editable text-receipt line (no number prefix).
 * Format: "<name> <qty><unit> <price> manat"
 * This is what parseTextReceipt() can parse back.
 *
 * @param {{ name:string, unit:string, price:number, quantity:number }} item
 * @returns {string}
 */
export function itemToLine(item) {
  const displayName = item.name.replace(/-/g, " ");
  const unitPrice = parseFloat(item.price.toFixed(2));
  return `${displayName} ${fmtQtyUnit(item)} ${unitPrice} manat`;
}

/**
 * Convert a list of parsed items to a numbered display list with | separators.
 * Each line: "<N>. <name> | <qty><unit> | <price> manat"
 *
 * The numbered format is shown to the user for editing convenience.
 * The user can correct a line by typing: "<N> <name> <qty><unit> <price> manat"
 *
 * @param {{ name:string, unit:string, price:number, quantity:number }[]} items
 * @returns {string}
 */
export function itemsToText(items) {
  return items
    .map((item, i) => {
      const displayName = item.name.replace(/-/g, " ");
      const unitPrice = parseFloat(item.price.toFixed(2));
      return `${i + 1}. ${displayName} | ${fmtQtyUnit(item)} | ${unitPrice} manat`;
    })
    .join("\n");
}

/**
 * Parse items from a text receipt string and return them together with
 * the numbered display text (for the confirmation workflow).
 *
 * @param {string} text
 * @returns {{ items: object[], editableText: string }}
 */
export function parseTextReceiptWithPreview(text) {
  const items = parseTextReceipt(text);
  const editableText = itemsToText(items);
  return {
    items,
    editableText
  };
}

/**
 * Parse items from a Gemini image-receipt response and return them together
 * with the numbered display text (for the confirmation workflow).
 *
 * @param {string} geminiResponse
 * @returns {{ items: object[], editableText: string }}
 */
export function parseImageReceiptWithPreview(geminiResponse) {
  const items = parseItems(geminiResponse);
  const editableText = itemsToText(items);
  return {
    items,
    editableText
  };
}

/**
 * Apply an inline line-edit command to a stored items array.
 *
 * The user sends: "<N> <name> <qty><unit> <price> manat"
 * e.g. "2 sosiska seher 300gr 55 manat"
 *
 * Returns { ok: true, items, editableText } on success,
 *         { ok: false, error } on failure.
 *
 * @param {object[]} items - current items array
 * @param {number}   lineNum - 1-based line number to replace
 * @param {string}   lineText - replacement line text (without the number prefix)
 * @returns {{ ok: boolean, items?: object[], editableText?: string, error?: string }}
 */
export function applyLineEdit(items, lineNum, lineText) {
  if (lineNum < 1 || lineNum > items.length) {
    return {
      ok: false,
      error: `❌ ${lineNum} nömrəli sətir yoxdur. 1–${items.length} arasında rəqəm yazın.`
    };
  }

  // Strip invisible Unicode characters and pipe-separated display format
  // if the user copied from the numbered list (e.g. "SABALID SOYULMUS 250qr | 1kg | 3 manat").
  const normalised = lineText
    .replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "")
    .replace(/\s*\|\s*/g, " ")
    .trim();

  const parsed = parseTextReceipt(normalised);
  if (parsed.length === 0) {
    return {
      ok: false,
      error: `❌ Format tanınmadı. Nümunə: *${lineNum} məhsul adı 3kg 100 manat*`
    };
  }

  // Deep-copy the FULL array then replace only the target line.
  const newItems = items.map((item) => ({
    ...item
  }));
  newItems[lineNum - 1] = parsed[0];
  return {
    ok: true,
    items: newItems,
    editableText: itemsToText(newItems)
  };
}

/**
 * Apply a batch of line-edit commands from a multi-line message.
 *
 * Each line of the message must start with a line number:
 *   "1. Pepsi Cola 250ml*24 | 3pcs | 10.42 manat"
 *   "2. Pepsi Cola 1 lt*12 | 8.4kg | 1.04 manat"
 *
 * Lines that don't start with a number are skipped.
 * Returns the updated items array plus a summary of what changed.
 *
 * @param {object[]} items - current items array
 * @param {string}   text  - raw multi-line message body
 * @returns {{ ok: boolean, items?: object[], editableText?: string, changed?: number[], errors?: string[], error?: string }}
 */
export function applyBatchEdit(items, text) {
  // Each line must start with a number (with optional dot)
  const LINE_RE = /^(\d+)\.?\s+(.+)$/;

  const cleanText = text.replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "");
  const msgLines = cleanText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Only treat as a batch edit if EVERY non-empty line starts with a number
  // (so a normal multi-line receipt isn't accidentally treated as a batch edit)
  const editLines = msgLines.filter((l) => LINE_RE.test(l));
  if (editLines.length === 0) {
    return {
      ok: false,
      error: "Heç bir düzəliş sətiri tapılmadı."
    };
  }
  if (editLines.length !== msgLines.length) {
    // Mixed message — some lines have numbers, some don't → not a batch edit
    return {
      ok: false,
      error: "mixed"
    };
  }

  const newItems = items.map((item) => ({
    ...item
  }));
  const changed = [];
  const errors = [];

  for (const line of editLines) {
    const m = line.match(LINE_RE);
    if (!m) continue;

    const lineNum = parseInt(m[1], 10);
    const lineText = m[2]
      .replace(/\s*\|\s*/g, " ")
      .trim();

    if (lineNum < 1 || lineNum > items.length) {
      errors.push(`❌ Sətir ${lineNum} mövcud deyil (1–${items.length})`);
      continue;
    }

    const parsed = parseTextReceipt(lineText);
    if (parsed.length === 0) {
      errors.push(`❌ Sətir ${lineNum}: format tanınmadı — "${lineText}"`);
      continue;
    }

    newItems[lineNum - 1] = parsed[0];
    changed.push(lineNum);
  }

  if (changed.length === 0) {
    return {
      ok: false,
      errors
    };
  }

  return {
    ok: true,
    items: newItems,
    editableText: itemsToText(newItems),
    changed,
    errors
  };
}

/**
 * Send a pre-parsed list of items to the API (shared by both image and text
 * confirmation paths).  Fetches existing inventory for fuzzy-matching, then
 * POSTs each item.
 *
 * @param {{ name:string, category:number, unit:string, supplier:number, price:number, quantity:number }[]} items
 * @returns {Promise<string>} human-readable summary
 */
export async function sendParsedItemsToApi(items) {
  if (items.length === 0) return "⚠️ Heç bir məhsul tapılmadı.";

  // Deep-copy so fuzzy-matching does not mutate the caller's array
  const workItems = items.map((item) => ({
    ...item
  }));

  const existingItems = await fetchExistingItems();

  for (const item of workItems) {
    const match = findBestMatch(item.name, existingItems);
    if (match) item.name = match;
  }

  const results = {
    success: [],
    failed: []
  };

  for (const item of workItems) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(item),
      });

      if (response.ok) {
        console.log(`✅ API: Sent "${item.name}" → ${response.status}`);
        results.success.push(`${item.name} (${item.quantity} ${item.unit} @ ${item.price})`);
      } else {
        const errorText = await response.text();
        console.error(`❌ API: Failed "${item.name}" → ${response.status}: ${errorText}`);
        results.failed.push(`${item.name} (${response.status})`);
      }
    } catch (err) {
      console.error(`❌ API: Network error for "${item.name}":`, err.message);
      results.failed.push(`${item.name} (network error)`);
    }
  }

  let summary = `📡 *API Nəticəsi*\n`;
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