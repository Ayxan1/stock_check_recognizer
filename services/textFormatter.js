/**
 * Format extracted text from receipt into a well-structured format
 * @param {string} rawText - Raw text extracted from OCR
 * @returns {string} - Formatted receipt text
 */
export function formatReceiptText(rawText) {
  try {
    // Clean up the text
    let formattedText = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    // Identify and format different sections
    formattedText = identifyAndFormatSections(formattedText);

    return formattedText;
  } catch (error) {
    console.error("❌ Error formatting text:", error);
    // Return raw text if formatting fails
    return rawText;
  }
}

/**
 * Identify and format different sections of the receipt
 * @param {string} text - Cleaned text
 * @returns {string} - Formatted text with sections
 */
function identifyAndFormatSections(text) {
  const lines = text.split("\n");
  const formattedLines = [];

  // Common Azerbaijani receipt keywords
  const storeNameIndicators = [
    "market",
    "mağaza",
    "mərkəz",
    "supermarket",
    "shop",
  ];
  const dateIndicators = ["tarix", "date", "gün"];
  const timeIndicators = ["saat", "vaxt", "time"];
  const totalIndicators = ["cəmi", "yekun", "toplam", "total", "ümumi"];
  const taxIndicators = ["ƏDV", "edv", "vergi", "tax", "vat"];
  const itemIndicators = /^\d+[\s\.]/; // Lines starting with numbers

  let inItemsList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Check if this is the store name (usually at the top)
    if (i < 3 && line.length > 3 && !line.match(/^\d/)) {
      formattedLines.push(`🏪 *${line}*`);
      continue;
    }

    // Check for date
    if (
      dateIndicators.some((indicator) => lowerLine.includes(indicator)) ||
      line.match(/\d{2}[\.\/\-]\d{2}[\.\/\-]\d{2,4}/)
    ) {
      formattedLines.push(`\n📅 ${line}`);
      continue;
    }

    // Check for time
    if (
      timeIndicators.some((indicator) => lowerLine.includes(indicator)) ||
      line.match(/\d{2}:\d{2}/)
    ) {
      formattedLines.push(`🕐 ${line}`);
      continue;
    }

    // Check for total amount
    if (totalIndicators.some((indicator) => lowerLine.includes(indicator))) {
      // Extract amount if present
      const amountMatch = line.match(/(\d+[.,]\d+|\d+)\s*(AZN|₼|manat)?/i);
      if (amountMatch) {
        formattedLines.push(`\n💰 *${line}*`);
      } else {
        formattedLines.push(`\n💰 *${line}*`);
      }
      inItemsList = false;
      continue;
    }

    // Check for tax
    if (taxIndicators.some((indicator) => lowerLine.includes(indicator))) {
      formattedLines.push(`📊 ${line}`);
      continue;
    }

    // Check for item lines (usually start with number or contain price)
    if (itemIndicators.test(line) || line.match(/\d+[.,]\d{2}/)) {
      if (!inItemsList) {
        formattedLines.push("\n📝 *Məhsullar:*");
        inItemsList = true;
      }
      formattedLines.push(`   • ${line}`);
      continue;
    }

    // Add other lines
    if (line.length > 2) {
      formattedLines.push(line);
    }
  }

  return formattedLines.join("\n");
}

/**
 * Extract specific information from receipt text
 * @param {string} text - Receipt text
 * @returns {Object} - Extracted information
 */
export function extractReceiptInfo(text) {
  const info = {
    storeName: null,
    date: null,
    time: null,
    total: null,
    items: [],
    tax: null,
  };

  const lines = text.split("\n");

  // Extract store name (usually first non-empty line)
  for (let line of lines) {
    if (line.trim().length > 3 && !line.match(/^\d/)) {
      info.storeName = line.trim();
      break;
    }
  }

  // Extract date
  const dateMatch = text.match(/(\d{2}[\.\/\-]\d{2}[\.\/\-]\d{2,4})/);
  if (dateMatch) {
    info.date = dateMatch[1];
  }

  // Extract time
  const timeMatch = text.match(/(\d{2}:\d{2}(?::\d{2})?)/);
  if (timeMatch) {
    info.time = timeMatch[1];
  }

  // Extract total
  const totalMatch = text.match(
    /(cəmi|yekun|toplam|total)[:\s]*(\d+[.,]\d+|\d+)/i,
  );
  if (totalMatch) {
    info.total = totalMatch[2];
  }

  return info;
}
