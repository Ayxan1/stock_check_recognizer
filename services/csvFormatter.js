/**
 * Format receipt data as CSV for Excel
 * @param {string} geminiResponse - Response from Gemini AI
 * @returns {string} - CSV formatted string
 */
export function formatAsCSV(geminiResponse) {
  try {
    // CSV başlığı - vergül ilə ayırırıq
    let csv = "Mehsul,Eded_Ceki,Qiymet_AZN,Cem_AZN\n";

    // Gemini cavabından məhsul məlumatlarını çıxarırıq
    const lines = geminiResponse.split("\n");

    for (const line of lines) {
      // Cədvəl sətirini tanıyırıq (| ilə ayrılmış)
      if (
        line.includes("|") &&
        !line.includes("Məhsul") &&
        !line.includes("---")
      ) {
        const parts = line
          .split("|")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        if (parts.length >= 4) {
          // Comma-separated values (CSV)
          const csvLine = parts.join(",");
          csv += csvLine + "\n";
        }
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
