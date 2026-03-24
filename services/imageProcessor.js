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

| Məhsul | Miqdar | Vahid | Qiymət | Cəm |
|--------|--------|-------|--------|-----|
| [ad] | [miqdar] | [vahid] | [qiymət] | [cəm] |

💰 CƏMİ: [toplam] AZN

==== QAYDALAR ====

1. MƏHSUL ADI:
   - Məhsul adını qəbzdə yazıldığı kimi OLDUĞU KİMİ köçür (çəki, qablama hər şeylə birlikdə).
   - Nümunə: "T.Biber SALÇA-BİZİM 680qr(1x12)" → adı elə bu kimi yaz.

2. MİQDAR — YALNIZ "Qədər" sütunundakı rəqəmi yaz. BAŞQA HEÇ NƏ YOX:
   - Qəbzdəki "Qədər" / "Say" sütununda hansı rəqəm varsa, onu olduğu kimi yaz.
   - Hesabat sütununu, qablama məlumatını MİQDAR KIMI YAZMA.
   - HEÇ BİR HESABLAMA ETMƏ. Sadəcə "Qədər" sütunundakı rəqəmi köçür.
   - Bu qəbzdən nümunələr:
     → "T.Biber SALÇA-BİZİM 680qr(1x12)" → Qədər sütunu = 3 → Miqdar = 3
     → "T.Bizim tarla tomatı 720qr(1x12)" → Qədər sütunu = 3 → Miqdar = 3
     → "Uksus 70% 160qr(1x40)7628"        → Qədər sütunu = 3 → Miqdar = 3
     → "Bulyon ROLTON TOYUQ 90qr(1x24)"   → Qədər sütunu = 1 → Miqdar = 1
     → "Sosiska Səhər 1kq"                → Qədər sütunu = 1 → Miqdar = 1
     → "Pen.MOZARELLA 1kq(Ağd)"           → Qədər sütunu = 1 → Miqdar = 1
     → "Süd Savuşkin 3.1%(1x12)"          → Qədər sütunu = 2 → Miqdar = 2
     → "Alpen.FINDIQ(1x24)"               → Qədər sütunu = 10 → Miqdar = 10
     → "Yumurta ELMAN(Kasset)"            → Qədər sütunu = 3 → Miqdar = 3

3. VAHİD:
   - Məhsul adında çəki (qr, kq, kg, g) varsa → "kg" yaz.
   - Çəki yoxdursa → "pcs" yaz.

4. QİYMƏT və CƏM:
   - Qəbzdəki "Ümumi məbləğ" sütunundakı rəqəmi "Cəm" kimi yaz.
   - Rəqəmləri DƏQİQ oxu, kəsr hissəsi nöqtə ilə (məsələn: 5.40, 19.68).
   - AZN sözünü yazma, yalnız rəqəm.`;

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
