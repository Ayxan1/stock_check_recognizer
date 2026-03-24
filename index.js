import dotenv from "dotenv";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { createCSVBuffer, formatAsCSV } from "./services/csvFormatter.js";
import { generateCurlForItems, sendItemsToApi } from "./services/curlFormatter.js";
import { processReceiptImage } from "./services/imageProcessor.js";
const { Client, LocalAuth, MessageMedia } = pkg;

dotenv.config();

// Initialize WhatsApp client with local authentication
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "receipt-reader-bot",
  }),
  // Do not show online/typing status
  markOnlineOnConnect: false,
  // Restart automatically if auth fails
  restartOnAuthFail: true,
  // Increase timeout for slow WhatsApp Web loading
  authTimeoutMs: 60000,
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
  puppeteer: {
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

// Generate QR code for authentication
client.on("qr", (qr) => {
  console.log("📱 Scan the QR code below to authenticate:");
  qrcode.generate(qr, { small: true });
});

// Client ready
client.on("ready", async () => {
  console.log("✅ WhatsApp Receipt Reader Bot is ready!");
  console.log("📸 Send me a receipt image and I'll convert it to text.");

  // Set presence to unavailable so the account doesn't appear online
  try {
    await client.sendPresenceUnavailable();
    console.log("🔕 Presence set to unavailable (status hidden).");
  } catch (e) {
    console.warn("⚠️ Could not set presence unavailable:", e.message);
  }
});

// Handle authentication
client.on("authenticated", () => {
  console.log("✅ Client authenticated successfully!");
});

// Handle authentication failure
client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failed:", msg);
});

// Handle disconnection - auto reinitialize
client.on("disconnected", (reason) => {
  console.log("⚠️ Client disconnected:", reason);
  console.log("🔄 Reinitializing in 5 seconds...");
  setTimeout(() => {
    client.initialize();
  }, 5000);
});

// Only process messages from this number
const ALLOWED_NUMBER = "994777333003@c.us";

// Handle incoming messages
client.on("message", async (message) => {
  try {
    // Ignore messages from anyone except the allowed number
    if (message.from !== ALLOWED_NUMBER) {
      console.log(`🚫 Ignored message from ${message.from}`);
      return;
    }

    // Check if message has media
    if (message.hasMedia) {
      const media = await message.downloadMedia();

      // Check if it's an image
      if (media.mimetype.startsWith("image/")) {
        console.log(`📷 Received image from ${message.from}`);

        // Send acknowledgment
        await message.reply("📸 Qəbz şəkli alındı. Emal olunur...");

        // Process the receipt image
        const extractedText = await processReceiptImage(
          media.data,
          media.mimetype,
        );

        if (extractedText && extractedText.trim().length > 0) {
          // Send the extracted text directly
          await message.reply(extractedText);

          // Send items to localhost:8000 API and report results
          try {
            const apiSummary = await sendItemsToApi(extractedText);
            if (apiSummary) {
              await message.reply(apiSummary);
              console.log(`📡 Items sent to API for ${message.from}`);
            }
          } catch (curlError) {
            console.error("❌ API send error:", curlError);
          }

          // Create and send CSV file
          try {
            const csvText = formatAsCSV(extractedText);
            if (csvText && csvText.split("\n").length > 2) {
              const csvBuffer = createCSVBuffer(csvText);
              const csvMedia = new MessageMedia(
                "text/csv",
                csvBuffer.toString("base64"),
                `qebz_${Date.now()}.csv`,
              );
              await message.reply(csvMedia);
              await message.reply("📊 Excel faylı göndərildi!");
              console.log(`📊 CSV file sent to ${message.from}`);
            }
          } catch (csvError) {
            console.error("❌ CSV creation error:", csvError);
          }

          console.log(`✅ Processed receipt for ${message.from}`);
        } else {
          await message.reply(
            "❌ Təəssüf ki, qəbzdən mətn oxuna bilmədi. Zəhmət olmasa daha aydın şəkil göndərin.",
          );
          console.log(`⚠️ No text extracted from image for ${message.from}`);
        }
      }
    } else if (
      message.body.toLowerCase() === "!help" ||
      message.body.toLowerCase() === "!kömək"
    ) {
      // Send help message
      const helpMessage = `
🤖 *Qəbz Oxuyan Bot*

*Necə istifadə edilir:*
1. Qəbz şəklini göndərin
2. Bot şəkli emal edəcək
3. Mətn formatında cavab alacaqsınız

*Tövsiyələr:*
✓ Şəkil aydın olsun
✓ Mətn oxunaqlı olsun
✓ Işıqlandırma yaxşı olsun
✓ Bütün qəbz çərçivədə olsun

Sualınız varsa *!help* yazın.
            `;
      await message.reply(helpMessage.trim());
    }
  } catch (error) {
    console.error("❌ Error processing message:", error);
    await message.reply("❌ Xəta baş verdi. Zəhmət olmasa yenidən cəhd edin.");
  }
});

// Handle errors
client.on("error", (error) => {
  console.error("❌ Client error:", error);
});

// Initialize the client
console.log("🚀 Starting WhatsApp Receipt Reader Bot...");
client.initialize();

// Handle process termination
process.on("SIGINT", async () => {
  console.log("\n⚠️ Shutting down bot...");
  await client.destroy();
  process.exit(0);
});
