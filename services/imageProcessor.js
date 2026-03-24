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

    const prompt = `Bu qəbz şəklindəki məlumatları diqqətlə oxuyub cədvəl formatında ver.
Aşağıdakı formatda DƏQIQ çıxart:

🏪 MAĞAZA: [mağaza adı]
📅 TARİX: [tarix]  
🕐 SAAT: [saat]

📝 MƏHSULLAR:

| Məhsul | Miqdar | Vahid | Qiymət | Cəm |
|--------|--------|-------|--------|-----|
| [ad] | [miqdar] | [vahid] | [qiymət] | [cəm] |
| [ad] | [miqdar] | [vahid] | [qiymət] | [cəm] |

💰 CƏMİ: [toplam] AZN

ÖNƏMLİ QAYDALAR:
- Hər məhsulun adını, miqdarını, vahidini, qiymətini və cəmini AYRI-AYRI sütunlarda göstər.
- Vahid (unit) YALNIZ "pcs" (ədəd üçün) və ya "kg" (çəki üçün) ola bilər.
- Rəqəmləri DƏQİQ oxu (kəsr hissələri nöqtə ilə ayır, məsələn: 7.8, 3.45, 69.60).
- Qiymət və Cəm DƏN YALNIZ rəqəm yaz (AZN sözünü yazma).
- Cədvəl formatını dəqiqliklə qoru.
- Toplam məbləği yoxla və düzgün hesabla.

ÇƏKİ VAHİDLƏRİNİ KG-A ÇEVİRMƏ QAYDALARI - ÇOX VACİBDİR:
- Qəbzdə çəki məlumatı aşağıdakı vahidlərdən birində ola bilər — HAMISI kg-a çevrilməlidir:
  → "qr", "qram", "gr", "g" → qramdan kg-a: miqdar ÷ 1000
     Nümunə: 460 qr → miqdar = 0.460, vahid = kg
     Nümunə: 250 g → miqdar = 0.250, vahid = kg
  → "kq", "kq.", "kg", "KQ", "KG" → artıq kg-dadır, dəyişdirmə
     Nümunə: 1.5 kq → miqdar = 1.5, vahid = kg
  → "ton", "t" → tondan kg-a: miqdar × 1000
     Nümunə: 0.5 ton → miqdar = 500, vahid = kg
- Çəki vahidi olan məhsullar üçün vahid HƏMİŞƏ "kg" olmalıdır, heç vaxt "pcs" yazma!

HESABAT SÜTUNU VƏ XÜSUSİ VAHİDLƏR ÜÇÜN QAYDALAR:
- Əgər qəbzdə "Hesabat" adlı sütun və ya sahə varsa, həmin sütundakı məlumatı miqdar hesablamaq üçün nəzərə al.
- Əgər məhsulun vahidi "kg" və ya "ədəd/əd" deyilsə (məsələn: sumka, kaset, top, bağlama, lüt və s.), Hesabat sütunundakı məlumatdan miqdarı müəyyən et.

HESABAT SÜTUNUNDA MİQDAR HESABLAMA QAYDALARI - ÇOX VACİBDİR:

- Hesabat sütununda "AxBxC" formatı varsa (DƏQIQ 3 HİSSƏ, məsələn: 1x5x1.5 və ya 2x10x0.8m):
  → Ümumi miqdar = A × B (birinci rəqəm VURULur ikinci rəqəmə)
  → Nümunə: "1x5x1.5m" → miqdar = 1 × 5 = 5, vahid = pcs
  → Nümunə: "2x10x0.8m" → miqdar = 2 × 10 = 20, vahid = pcs
  → Nümunə: "3x4x1.2m" → miqdar = 3 × 4 = 12, vahid = pcs

- Hesabat sütununda "AxB" formatı varsa (DƏQIQ 2 HİSSƏ, məsələn: 3x2.5 və ya 2x4.80):
  → Ümumi miqdar = A (yalnız BİRİNCİ rəqəm, B-ni işlətmə)
  → B rəqəmi vahid qiymətdir, miqdar DEYİL
  → Nümunə: "3x2.5" → miqdar = 3, qiymət = 2.5, vahid = pcs
  → Nümunə: "2x4.80" → miqdar = 2, qiymət = 4.80, vahid = pcs
  → XƏBƏRDARLIQ: B dəyərini (2.5, 4.80 və s.) HEÇ VAXT miqdar kimi yazma!`;

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
