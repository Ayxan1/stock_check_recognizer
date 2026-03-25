import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import sharp from "sharp";
import Tesseract from "tesseract.js";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const USE_GEMINI =
  process.env.USE_GEMINI === "true" && process.env.GEMINI_API_KEY;

/**
 * Process receipt image and extract text using OCR
 * @param {string} imageData - Base64 encoded image data
 * @param {string} mimeType - MIME type of the image
 * @returns {Promise<string>} - Extracted text from the image
 */
export async function processReceiptImage(imageData, mimeType) {
  try {
    console.log("🔄 Starting image processing...");

    // Use Google Gemini if configured, otherwise fallback to Tesseract
    if (USE_GEMINI) {
      console.log("🤖 Using Google Gemini AI for OCR...");
      return await processWithGemini(imageData, mimeType);
    } else {
      console.log("🔍 Using Tesseract OCR...");
      return await processWithTesseract(imageData);
    }
  } catch (error) {
    console.error("❌ Error processing image:", error);

    // Fallback to Tesseract if Gemini fails
    if (USE_GEMINI) {
      console.log("⚠️ Gemini failed, falling back to Tesseract...");
      try {
        return await processWithTesseract(imageData);
      } catch (fallbackError) {
        throw new Error("Failed to process receipt image with both methods");
      }
    }

    throw new Error("Failed to process receipt image");
  }
} /**
 * Process image using Google Gemini Vision API
 * @param {string} imageData - Base64 encoded image data
 * @param {string} mimeType - MIME type of the image
 * @returns {Promise<string>} - Extracted text
 */
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processWithGemini(imageData, mimeType, retryCount = 0) {
  const MAX_RETRIES = 3;
  try {
    // Using Gemini 1.5 Flash - 1500 free requests/day vs 20 for 2.5 Flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Bu qəbz şəklindəki məlumatları oxuyub aşağıdakı cədvəl formatında ver.

🏪 MAĞAZA: [mağaza adı]
📅 TARİX: [tarix]
🕐 SAAT: [saat]

📝 MƏHSULLAR:

| Məhsul | Miqdar | Vahid | Vahid Qiymət |
|--------|--------|-------|--------------|
| [ad] | [miqdar] | [vahid] | [vahid qiymət] |

💰 CƏMİ: [toplam] AZN

==== QAYDALAR ====

1. MƏHSUL ADI:
   - Məhsul adını qəbzdə yazıldığı kimi OLDUĞU KİMİ köçür (çəki, qablama hər şeylə birlikdə).
   - Nümunə: "T.Biber SALÇA-BİZİM 680qr(1x12)" → adı elə bu kimi yaz.

2. MİQDAR — YALNIZ "Miqdar" / "Qədər" / "Say" sütunundakı rəqəmi yaz. HEÇ BİR HESABLAMA ETMƏ:
   - Qəbzdəki "Miqdar" / "Qədər" / "Say" sütununda hansı rəqəm varsa, onu olduğu kimi yaz.
   - Kəsr ədədləri nöqtə ilə yaz (məsələn: 5.000, 0.555, 1.450).
   - Bu qəbzdən nümunələr:
     → "DUYU GULNAR"            → Miqdar sütunu = 5.000  → Miqdar = 5.000
     → "SARI KISMIS RASSIN"     → Miqdar sütunu = 0.555  → Miqdar = 0.555
     → "SARIKOK SIRLANKA KQ"    → Miqdar sütunu = 0.540  → Miqdar = 0.540
     → "TAMAT TARAVAT 1.450"    → Miqdar sütunu = 1.000  → Miqdar = 1.000
     → "T.Biber SALÇA-BİZİM 680qr(1x12)" → Miqdar sütunu = 3 → Miqdar = 3
     → "Bulyon ROLTON TOYUQ 90qr(1x24)"  → Miqdar sütunu = 1 → Miqdar = 1
     → "Alpen.FINDIQ(1x24)"              → Miqdar sütunu = 10 → Miqdar = 10

3. VAHİD — qəbzdəki "Ölçü vahidi" / "Ölçü v." sütunundakı dəyəri yaz:
   - Yalnız qəbzdə yazılan vahidi köçür. Ola biləcək dəyərlər: kq, kg, g, qr, eded, l, ml, pcs
   - Əgər qəbzdə "kq" yazılıbsa → "kq" yaz.
   - Əgər qəbzdə "eded" yazılıbsa → "eded" yaz.
   - Əgər vahid sütunu boşdursa → "pcs" yaz.
   - Bu qəbzdən nümunələr:
     → "DUYU GULNAR"         → Ölçü vahidi = kq   → Vahid = kq
     → "SARI KISMIS RASSIN"  → Ölçü vahidi = kq   → Vahid = kq
     → "SARIKOK SIRLANKA KQ" → Ölçü vahidi = kq   → Vahid = kq
     → "TAMAT TARAVAT 1.450" → Ölçü vahidi = eded → Vahid = eded

4. VAHİD QİYMƏT — 1 vahidin qiyməti (unit price):
   - Qəbzdəki "Qiymət" / "Vahid qiymət" / "Qiy." sütunundakı rəqəmi yaz.
   - Bu ümumi/cəm məbləğ DEYİL — 1 ədəd / 1 kq / 1 l üçün qiymətdir.
   - Əgər qəbzdə yalnız ümumi məbləğ (Məbləğ / Cəm) varsa, vahid qiyməti özün hesabla:
       Vahid qiymət = Ümumi məbləğ ÷ Miqdar
   - Rəqəmləri DƏQİQ oxu, kəsr hissəsi nöqtə ilə (məsələn: 5.40, 19.68).
   - AZN sözünü yazma, yalnız rəqəm.
   - Nümunələr:
     → Miqdar=5.000 kq, Ümumi=27.00  → Vahid qiymət = 5.40
     → Miqdar=3 eded, Ümumi=8.10     → Vahid qiymət = 2.70
     → Miqdar=1 eded, Qiymət=12.50   → Vahid qiymət = 12.50`;

    const imageParts = [
      {
        inlineData: {
          data: imageData,
          mimeType: mimeType,
        },
      },
    ];

    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const extractedText = response.text();

    console.log("✅ Gemini OCR completed successfully");
    return extractedText;
  } catch (error) {
    // Handle rate limit (429) with automatic retry
    if (error.status === 429 && retryCount < MAX_RETRIES) {
      // Extract retry delay from error details, default to 60s
      const retryDelay =
        error.errorDetails?.find(
          (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
        )?.retryDelay ?? "60s";
      const delayMs = (parseInt(retryDelay) || 60) * 1000;

      console.warn(
        `⚠️ Gemini rate limit hit. Retrying in ${delayMs / 1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      );
      await sleep(delayMs);
      return processWithGemini(imageData, mimeType, retryCount + 1);
    }

    console.error("❌ Gemini API error:", error.message);
    throw error;
  }
}

/**
 * Process image using Tesseract OCR
 * @param {string} imageData - Base64 encoded image data
 * @returns {Promise<string>} - Extracted text
 */
async function processWithTesseract(imageData) {
  // Convert base64 to buffer
  const imageBuffer = Buffer.from(imageData, "base64");

  // Preprocess image for better OCR results
  const processedImage = await preprocessImage(imageBuffer);

  // Perform OCR with Azerbaijani language support
  const result = await Tesseract.recognize(
    processedImage,
    "aze+eng", // Azerbaijani + English for better recognition
    {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log(`📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    },
  );

  console.log("✅ Tesseract OCR completed successfully");
  return result.data.text;
}

/**
 * Preprocess image to improve OCR accuracy
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Buffer>} - Processed image buffer
 */
async function preprocessImage(imageBuffer) {
  try {
    console.log("🖼️ Preprocessing image...");

    // Apply image enhancements for better OCR
    const processedBuffer = await sharp(imageBuffer)
      .grayscale() // Convert to grayscale
      .normalize() // Normalize contrast
      .sharpen() // Sharpen edges
      .resize(null, 2000, {
        // Resize to optimal height for OCR
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();

    console.log("✅ Image preprocessing completed");
    return processedBuffer;
  } catch (error) {
    console.error("❌ Error preprocessing image:", error);
    // Return original buffer if preprocessing fails
    return imageBuffer;
  }
}
