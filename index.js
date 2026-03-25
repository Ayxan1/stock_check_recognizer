import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import {
  isTextReceipt,
  parseImageReceiptWithPreview,
  parseTextReceiptWithPreview,
  sendParsedItemsToApi,
} from "./services/curlFormatter.js";
import { processReceiptImage } from "./services/imageProcessor.js";

const { Client, LocalAuth, MessageMedia } = pkg;

dotenv.config();

// ─── Express HTTP Server ──────────────────────────────────────────────────────
const app = express();
const HTTP_PORT = process.env.WHATSAPP_SERVICE_PORT || 3001;

app.use(cors());
app.use(express.json());

// Shared WhatsApp state (used by both the HTTP API and the WA client events)
let client;
let isReady = false;
let qrCode  = null;

// Health Check
app.get("/health", (_req, res) => {
  res.json({ status: "running", whatsapp_ready: isReady, timestamp: new Date().toISOString() });
});

// Status
app.get("/status", (_req, res) => {
  res.json({
    ready: isReady,
    qr_code: qrCode,
    message: isReady
      ? "WhatsApp is connected and ready"
      : qrCode
        ? "Please scan the QR code to authenticate"
        : "WhatsApp is initializing...",
  });
});

// QR Code
app.get("/qr", (_req, res) => {
  if (isReady)  return res.json({ success: false, message: "WhatsApp is already authenticated" });
  if (qrCode)   return res.json({ success: true, qr_code: qrCode });
  res.json({ success: false, message: "QR code not available yet. Please wait..." });
});

// Send Message
app.post("/send-message", async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message)
    return res.status(400).json({ success: false, error: "Phone number and message are required" });
  if (!isReady)
    return res.status(503).json({ success: false, error: "WhatsApp is not ready. Please scan QR code first.", qr_available: !!qrCode });

  try {
    let formattedPhone = phone.replace(/\D/g, "");
    if (!formattedPhone.startsWith("994") && formattedPhone.length < 12)
      formattedPhone = "994" + formattedPhone;

    await client.sendMessage(formattedPhone + "@c.us", message);
    console.log(`✅ Message sent to ${phone}`);
    res.json({ success: true, message: "Message sent successfully", to: phone });
  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).json({ success: false, error: "Failed to send message", details: error.message });
  }
});

// Notify Order Deletion
app.post("/notify-order-deletion", async (req, res) => {
  const {
    owner_phone, admin_name, room_name, table_number,
    order_id, order_created_at, deleted_at,
    meal_name, quantity, price, reason_display, comment,
  } = req.body;

  if (!owner_phone)
    return res.status(400).json({ success: false, error: "Owner phone number is required" });
  if (!isReady)
    return res.status(503).json({ success: false, error: "WhatsApp is not ready. Please scan QR code first.", qr_available: !!qrCode });

  try {
    let msg  = `🚨 *SİFARİŞ MƏHSUL SİLİNDİ*\n\n`;
    msg += `👤 *Admin:* ${admin_name    || "N/A"}\n`;
    msg += `🏠 *Zal:* ${room_name       || "N/A"}\n`;
    msg += `🍽️ *Masa:* ${table_number   || "N/A"}\n`;
    msg += `🆔 *Sifariş:* #${order_id   || "N/A"}\n\n`;
    msg += `📦 *Məhsul:* ${meal_name    || "N/A"}\n`;
    msg += `🔢 *Miqdar:* ${quantity     || 0}\n`;
    msg += `💰 *Qiymət:* ${price        || 0} AZN\n\n`;
    msg += `📋 *Səbəb:* ${reason_display|| "N/A"}\n\n`;
    msg += `⏰ *Sifariş vaxtı:* ${order_created_at || "N/A"}\n`;
    msg += `🗑️ *Silinmə vaxtı:* ${deleted_at       || "N/A"}`;
    if (comment) msg += `\n\n💬 *Qeyd:* ${comment}`;

    let formattedPhone = owner_phone.replace(/\D/g, "");
    if (!formattedPhone.startsWith("994") && formattedPhone.length < 12)
      formattedPhone = "994" + formattedPhone;

    await client.sendMessage(formattedPhone + "@c.us", msg);
    console.log(`✅ Order deletion notification sent to ${owner_phone}`);
    res.json({ success: true, message: "Notification sent successfully", to: owner_phone });
  } catch (error) {
    console.error("❌ Error sending notification:", error);
    res.status(500).json({ success: false, error: "Failed to send notification", details: error.message });
  }
});

// Logout
app.post("/logout", async (_req, res) => {
  try {
    if (client) await client.logout();
    console.log("📤 WhatsApp logged out");
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("❌ Error logging out:", error);
    res.status(500).json({ success: false, error: "Failed to logout", details: error.message });
  }
});

// Start HTTP server
app.listen(HTTP_PORT, () => {
  console.log("=".repeat(60));
  console.log(`🚀 WhatsApp HTTP Service running on port ${HTTP_PORT}`);
  console.log("=".repeat(60));
  console.log(`  GET  http://localhost:${HTTP_PORT}/health`);
  console.log(`  GET  http://localhost:${HTTP_PORT}/status`);
  console.log(`  GET  http://localhost:${HTTP_PORT}/qr`);
  console.log(`  POST http://localhost:${HTTP_PORT}/send-message`);
  console.log(`  POST http://localhost:${HTTP_PORT}/notify-order-deletion`);
  console.log(`  POST http://localhost:${HTTP_PORT}/logout`);
  console.log("=".repeat(60));
});

// ─── WhatsApp Client ──────────────────────────────────────────────────────────

const ALLOWED_NUMBER = process.env.ALLOWED_NUMBER || "994777333003@c.us";

/**
 * Per-user pending drafts.
 * Shape: Map<userId, { editableText: string, source: "image"|"text" }>
 *
 * When a receipt is received (image or text), the bot parses it, converts
 * it to the editable text format, and stores it here.  The user can:
 *   • Reply "ok" / "bəli" / "göndər"   → parse stored text, send to API
 *   • Reply "ləğv" / "cancel" / "xeyr"  → discard draft
 *   • Reply with edited text            → update draft, re-show confirmation prompt
 */
const pendingDrafts = new Map();

client = new Client({
  authStrategy: new LocalAuth({
    clientId: "receipt-reader-bot",
    dataPath: "./whatsapp-session",
  }),
  markOnlineOnConnect: false,
  restartOnAuthFail: true,
  authTimeoutMs: 60000,
  puppeteer: {
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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

client.on("qr", (qr) => {
  console.log("📱 Scan the QR code below to authenticate:");
  qrcode.generate(qr, { small: true });
  qrCode  = qr;
  isReady = false;
});

client.on("ready", async () => {
  console.log("✅ WhatsApp Receipt Reader Bot is ready!");
  isReady = true;
  qrCode  = null;
  try {
    await client.sendPresenceUnavailable();
    console.log("🔕 Presence set to unavailable (status hidden).");
  } catch (e) {
    console.warn("⚠️ Could not set presence unavailable:", e.message);
  }
});

client.on("authenticated", () => {
  console.log("✅ Client authenticated successfully!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Authentication failed:", msg);
  isReady = false;
});

client.on("disconnected", (reason) => {
  console.log("⚠️ Client disconnected:", reason);
  isReady = false;
  console.log("🔄 Reinitializing in 5 seconds...");
  setTimeout(() => client.initialize(), 5000);
});

// ─── Incoming Message Handler ─────────────────────────────────────────────────
client.on("message", async (message) => {
  try {
    if (message.from !== ALLOWED_NUMBER) {
      console.log(`🚫 Ignored message from ${message.from}`);
      return;
    }

    const userId   = message.from;
    const bodyLow  = (message.body || "").trim().toLowerCase();
    const hasDraft = pendingDrafts.has(userId);

    // ── Help command ─────────────────────────────────────────────────────────
    if (["!help", "!kömək"].includes(bodyLow)) {
      await message.reply(`🤖 *Qəbz Oxuyan Bot*

*Necə istifadə edilir:*
1. Qəbz şəklini göndərin — bot emal edəcək
2. Mətn formatında qəbz göndərin

*Mətn qəbzi nümunəsi:*
  xlor 3kg 300 manat
  sosiska 300gr 400 manat
  pepsi 12 12 manat

*Təsdiq addımı:*
  • Bot məhsulları göstərəcək
  • *ok* / *bəli* / *göndər* yazın → API-yə göndər
  • *ləğv* / *xeyr* / *cancel* yazın → imtina
  • Siyahını redaktə edib göndərin → yeni baxış

Sualınız varsa *!help* yazın.`);
      return;
    }

    // ── Confirmation: "ok" / "bəli" / "göndər" ──────────────────────────────
    if (hasDraft && ["ok", "bəli", "gonder", "göndər", "yes"].includes(bodyLow)) {
      const draft = pendingDrafts.get(userId);
      pendingDrafts.delete(userId);

      await message.reply("📡 Məhsullar API-yə göndərilir...");

      try {
        const { items } = parseTextReceiptWithPreview(draft.editableText);
        if (items.length === 0) {
          await message.reply("⚠️ Heç bir məhsul aşkar edilmədi. Siyahını yoxlayın.");
          return;
        }
        const summary = await sendParsedItemsToApi(items);
        await message.reply(summary);
        console.log(`✅ Draft confirmed and sent to API for ${userId}`);
      } catch (err) {
        console.error("❌ API send error:", err);
        await message.reply("❌ API xətası baş verdi. Zəhmət olmasa yenidən cəhd edin.");
      }
      return;
    }

    // ── Confirmation: "ləğv" / "xeyr" / "cancel" ────────────────────────────
    if (hasDraft && ["ləğv", "legv", "xeyr", "cancel", "no", "imtina"].includes(bodyLow)) {
      pendingDrafts.delete(userId);
      await message.reply("🚫 Qəbz ləğv edildi. Yeni qəbz göndərə bilərsiniz.");
      console.log(`🚫 Draft cancelled for ${userId}`);
      return;
    }

    // ── Image receipt ────────────────────────────────────────────────────────
    if (message.hasMedia) {
      const media = await message.downloadMedia();
      if (!media.mimetype.startsWith("image/")) return;

      console.log(`📷 Received image from ${userId}`);
      await message.reply("📸 Qəbz şəkli alındı. Emal olunur...");

      const geminiText = await processReceiptImage(media.data, media.mimetype);

      if (!geminiText || geminiText.trim().length === 0) {
        await message.reply("❌ Təəssüf ki, qəbzdən mətn oxuna bilmədi. Zəhmət olmasa daha aydın şəkil göndərin.");
        console.log(`⚠️ No text extracted from image for ${userId}`);
        return;
      }

      const { items, editableText } = parseImageReceiptWithPreview(geminiText);

      if (items.length === 0) {
        await message.reply("⚠️ Şəkildən heç bir məhsul aşkar edilmədi. Siyahını əl ilə göndərə bilərsiniz.");
        return;
      }

      pendingDrafts.set(userId, { editableText, source: "image" });
      console.log(`📝 Image draft stored for ${userId} (${items.length} items)`);

      await message.reply(
        `📋 *Aşkar edilən məhsullar (${items.length} ədəd):*\n\n` +
        `${editableText}\n\n` +
        `✏️ Siyahını redaktə edə bilərsiniz.\n` +
        `✅ Göndərmək üçün *ok* yazın\n` +
        `❌ İmtina etmək üçün *ləğv* yazın`
      );
      return;
    }

    // ── Edited draft reply ────────────────────────────────────────────────────
    // If user has a pending draft and sends a new text receipt, treat it as an edit.
    if (hasDraft && isTextReceipt(message.body)) {
      const { items, editableText } = parseTextReceiptWithPreview(message.body);

      if (items.length === 0) {
        await message.reply("⚠️ Göndərdiyiniz mətn qəbz kimi tanınmadı. Formatı yoxlayın.\n\nMövcud siyahı hələ də gözləyir. *ok* / *ləğv* yazın.");
        return;
      }

      pendingDrafts.set(userId, { editableText, source: "text" });
      console.log(`✏️ Draft updated for ${userId} (${items.length} items)`);

      await message.reply(
        `✏️ *Yenilənmiş siyahı (${items.length} ədəd):*\n\n` +
        `${editableText}\n\n` +
        `✅ Göndərmək üçün *ok* yazın\n` +
        `❌ İmtina etmək üçün *ləğv* yazın`
      );
      return;
    }

    // ── Fresh text receipt (no pending draft) ────────────────────────────────
    if (isTextReceipt(message.body)) {
      console.log(`📝 Received text receipt from ${userId}`);
      await message.reply("📝 Mətn qəbzi alındı. Emal olunur...");

      const { items, editableText } = parseTextReceiptWithPreview(message.body);

      if (items.length === 0) {
        await message.reply("⚠️ Heç bir məhsul aşkar edilmədi. Formatı yoxlayın.");
        return;
      }

      pendingDrafts.set(userId, { editableText, source: "text" });
      console.log(`📝 Text draft stored for ${userId} (${items.length} items)`);

      await message.reply(
        `📋 *Aşkar edilən məhsullar (${items.length} ədəd):*\n\n` +
        `${editableText}\n\n` +
        `✏️ Siyahını redaktə edə bilərsiniz.\n` +
        `✅ Göndərmək üçün *ok* yazın\n` +
        `❌ İmtina etmək üçün *ləğv* yazın`
      );
      return;
    }

    // ── Unrecognised message while draft is pending ──────────────────────────
    if (hasDraft) {
      const draft = pendingDrafts.get(userId);
      await message.reply(
        `⚠️ Mesaj tanınmadı. Mövcud siyahı hələ gözləyir:\n\n` +
        `${draft.editableText}\n\n` +
        `✅ Göndərmək üçün *ok* yazın\n` +
        `❌ İmtina etmək üçün *ləğv* yazın`
      );
    }

  } catch (error) {
    console.error("❌ Error processing message:", error);
    try {
      await message.reply("❌ Xəta baş verdi. Zəhmət olmasa yenidən cəhd edin.");
    } catch (_) {}
  }
});

client.on("error", (error) => {
  console.error("❌ Client error:", error);
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
console.log("🚀 Starting WhatsApp Receipt Reader Bot...");
client.initialize();

process.on("SIGINT", async () => {
  console.log("\n⚠️ Shutting down gracefully...");
  if (client) await client.destroy();
  process.exit(0);
});
