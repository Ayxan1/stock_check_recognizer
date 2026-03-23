import dotenv from "dotenv";

dotenv.config();

async function checkModels() {
  try {
    console.log("🔍 API-də mövcud modellər yoxlanılır...\n");

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("❌ GEMINI_API_KEY tapılmadı!");
      return;
    }

    // API-dən model siyahısını alırıq
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );

    if (!response.ok) {
      console.error(`❌ API xətası: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(errorText);
      return;
    }

    const data = await response.json();

    console.log(`✅ Tapılan model sayı: ${data.models?.length || 0}\n`);

    // Hər modeli göstəririk
    if (data.models) {
      data.models.forEach((model, index) => {
        console.log(`${index + 1}. Model:`);
        console.log(`   Ad: ${model.name}`);
        console.log(`   Display Ad: ${model.displayName || "N/A"}`);
        console.log(`   Versiya: ${model.version || "N/A"}`);
        console.log(
          `   Metodlar: ${model.supportedGenerationMethods?.join(", ") || "N/A"}`,
        );
        console.log("");
      });

      // Vision dəstəyi olan modelləri filter edirik
      const visionModels = data.models.filter((m) =>
        m.supportedGenerationMethods?.includes("generateContent"),
      );

      console.log("\n📸 ŞƏKIL OXUYA BİLƏN MODELLƏR:");
      visionModels.forEach((m) => {
        const modelId = m.name.replace("models/", "");
        console.log(`   ✓ ${modelId}`);
      });

      console.log("\n💡 imageProcessor.js-də istifadə etmək üçün:");
      if (visionModels.length > 0) {
        const firstModel = visionModels[0].name.replace("models/", "");
        console.log(
          `   const model = genAI.getGenerativeModel({ model: "${firstModel}" });`,
        );
      }
    }
  } catch (error) {
    console.error("❌ Xəta baş verdi:", error.message);
  }
}

checkModels();
