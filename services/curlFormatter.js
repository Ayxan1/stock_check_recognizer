export function generateCurlForItems(geminiResponse) {
  try {
    let curls = [];

    // Parse the table from Gemini response
    const lines = geminiResponse.split("\n");

    for (const line of lines) {
      // Find table rows
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
          // Need at least name, quantity, unit, price
          // format based on prompt: | [ad] | [miqdar] | [vahid] | [qiymət] | [cəm] |
          const name = parts[0];

          let quantityRaw = parts[1].replace(/[^\d.,]/g, "").replace(",", ".");
          const quantity = parseFloat(quantityRaw) || 1;

          let unitRaw = parts[2].toLowerCase();
          let unit = "pcs";
          if (unitRaw.includes("kg") || unitRaw.includes("kq")) {
            unit = "kg";
          }

          let priceRaw = parts[3].replace(/[^\d.,]/g, "").replace(",", ".");
          const price = parseFloat(priceRaw) || 0;

          const itemJson = {
            name: name,
            category: 1,
            unit: unit,
            supplier: 1,
            price: price,
            quantity: quantity,
          };

          const curl = `curl --location 'http://localhost:8000/api/inventory/inventory-items/add-or-update/' \\
--header 'Content-Type: application/json' \\
--data '${JSON.stringify(itemJson, null, 2)}'`;

          curls.push(curl);
        }
      }
    }

    if (curls.length > 0) {
      return `Budur məhsullar üçün yaranacaq server (API) sorğuları:\n\n${curls.join("\n\n")}`;
    }

    return null;
  } catch (error) {
    console.error("❌ CURL formatlaşdırma xətası:", error);
    return null;
  }
}
