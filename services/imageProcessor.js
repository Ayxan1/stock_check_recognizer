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
async function processWithGemini(imageData, mimeType) {
  try {
    // Using Gemini 2.5 Flash - latest stable multimodal model
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
- Vahid (unit) YALNIZ "pcs" (ədəd üçün) və ya "kg" (çəki üçün) ola bilər. Məsələn, 0.460 kq üçün miqdar: 0.46, vahid: kg olmalıdır. 2 ədəd üçün miqdar: 2, vahid: pcs olmalıdır.
- Rəqəmləri DƏQİQ oxu (kəsr hissələri nöqtə ilə ayır, məsələn: 7.8, 3.45, 69.60).
- Qiymət və Cəm DƏN YALNIZ rəqəm yaz (AZN sözünü yazma).
- Cədvəl formatını dəqiqliklə qoru.
- Toplam məbləği yoxla və düzgün hesabla.`;

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
