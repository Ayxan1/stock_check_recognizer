/**
 * Normalise a unit string coming from the check's Ölçü vahidi column.
 * Returns a canonical unit: "kg", "g", "l", "ml", or "pcs".
 *
 * @param {string} rawUnit - unit as read from the receipt (e.g. "kq", "eded", "")
 * @returns {{ unit: string, isWeight: boolean, isMl: boolean }}
 */
function normaliseUnit(rawUnit) {
  const u = (rawUnit || "").trim().toLowerCase();

  if (u === "kq" || u === "kg") return { unit: "kg",  isWeight: true,  isMl: false };
  if (u === "g"  || u === "qr" || u === "gr") return { unit: "g",  isWeight: true,  isMl: false };
  if (u === "l"  || u === "litr") return { unit: "l",  isWeight: false, isMl: false };
  if (u === "ml")                 return { unit: "ml", isWeight: false, isMl: true  };

  // "eded", "pcs", "" or anything else → piece-based
  return { unit: "pcs", isWeight: false, isMl: false };
}

/**
 * Format receipt data as CSV for Excel.
 * Gemini now provides 4 columns: Məhsul | Miqdar | Vahid | Cəm
 *
 * Output CSV columns: Mehsul, Miqdar, Vahid, Qiymet_AZN, Cem_AZN
 *
 * @param {string} geminiResponse - Response from Gemini AI
 * @returns {string} - CSV formatted string
 */
export function formatAsCSV(geminiResponse) {
  try {
    // CSV başlığı
    let csv = "Mehsul,Miqdar,Vahid,Qiymet_AZN,Cem_AZN\n";

    const lines = geminiResponse.split("\n");

    for (const line of lines) {
      // Cədvəl sətirini tanıyırıq (| ilə ayrılmış, başlıq və ayırıcı xətlər xaric)
      if (
        line.includes("|") &&
        !line.includes("Məhsul") &&
        !line.includes("Miqdar") &&
        !line.includes("Say") &&
        !line.includes("---")
      ) {
        const parts = line
          .split("|")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        // Support both old (3-col) and new (4-col) Gemini output gracefully
        let name, miqdar, rawUnit, totalPrice;

        if (parts.length >= 4) {
          // New format: Məhsul | Miqdar | Vahid | Cəm
          name       = parts[0];
          miqdar     = parseFloat(parts[1].replace(",", ".")) || 1;
          rawUnit    = parts[2];
          totalPrice = parseFloat(parts[3].replace(",", ".")) || 0;
        } else if (parts.length === 3) {
          // Legacy 3-col format: Məhsul | Say | Cəm — infer unit from name
          name       = parts[0];
          miqdar     = parseFloat(parts[1].replace(",", ".")) || 1;
          rawUnit    = "";   // will fall back to pcs
          totalPrice = parseFloat(parts[2].replace(",", ".")) || 0;
        } else {
          continue;
        }

        const { unit } = normaliseUnit(rawUnit);

        // Unit price = total price ÷ miqdar
        const unitPrice = miqdar > 0
          ? parseFloat((totalPrice / miqdar).toFixed(2))
          : 0;

        // Escape product name for CSV (wrap in quotes to handle commas)
        const safeName = `"${name.replace(/"/g, '""')}"`;
        csv += `${safeName},${miqdar},${unit},${unitPrice},${totalPrice}\n`;
      }
    }

    return csv;
  } catch (error) {
    console.error("❌ CSV formatlaşdırma xətası:", error);
    return null;
  }
}

/**
 * Create CSV buffer from text
 * @param {string} csvText - CSV formatted text
 * @returns {Buffer} - Buffer for file attachment
 */
export function createCSVBuffer(csvText) {
  // UTF-16LE BOM - Excel Windows-da Azərbaycan hərflərini düzgün göstərir
  const BOM = Buffer.from([0xff, 0xfe]);
  const textBuffer = Buffer.from(csvText, "utf16le");
  return Buffer.concat([BOM, textBuffer]);
}
