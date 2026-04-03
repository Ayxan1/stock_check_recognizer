import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import {
  applyBatchEdit,
  applyLineEdit,
  isTextReceipt,
  parseImageReceiptWithPreview,
  parseTextReceiptWithPreview,
  sendParsedItemsToApi,
} from "./services/curlFormatter.js";
import { processReceiptImage } from "./services/imageProcessor.js";

const { Client, LocalAuth, MessageMedia, Poll } = pkg;

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

const ALLOWED_CONTACTS = new Set([
  process.env.ALLOWED_CONTACTS || "Kamran Hajili", "t"
]);

/**
 * Per-user pending drafts.
 * Shape: Map<userId, { items: object[], editableText: string, source: "image"|"text", pollId: string|null }>
 *
 * When a receipt is received the bot parses it, stores the items array here,
 * shows a numbered list, and sends a Poll for one-tap confirm/cancel.
 * The user can also:
 *   • Vote "✅ Göndər" on the poll          → send stored items to API
 *   • Vote "❌ Ləğv et" on the poll         → discard draft
 *   • Type "ok" / "bəli" / "göndər"         → send stored items to API
 *   • Type "ləğv" / "xeyr" / "cancel"       → discard draft
 *   • Type "<N> <name> <qty><unit> <price>"  → replace line N, re-show list
 */
const pendingDrafts = new Map();

/**
 * Maps poll message ID → userId so vote_update can find the right draft.
 * Shape: Map<pollMsgId, userId>
 */
const pollToUser = new Map();

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
    args: ['--no-sandbox', '--disable-setuid-sandbox']
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

// ─── Poll Vote Handler ────────────────────────────────────────────────────────

client.on("vote_update", async (vote) => {
  try {
    const pollMsgId = vote.parentMessage?.id?._serialized;
    if (!pollMsgId) return;

    const userId = pollToUser.get(pollMsgId);
    if (!userId) return; // not one of our polls

    const selectedOptions = vote.selectedOptions?.map((o) => o.name) ?? [];
    console.log(`🗳️ Poll vote from ${userId}: [${selectedOptions.join(", ")}]`);

    const chat = await client.getChatById(userId);

    // ── "✅ Göndər" ────────────────────────────────────────────────────────
    if (selectedOptions.includes("✅ Göndər")) {
      const draft = pendingDrafts.get(userId);
      if (!draft) {
        await chat.sendMessage("⚠️ Aktiv siyahı tapılmadı. Yeni qəbz göndərin.");
        pollToUser.delete(pollMsgId);
        return;
      }

      pendingDrafts.delete(userId);
      pollToUser.delete(pollMsgId);

      await chat.sendMessage("📡 Məhsullar API-yə göndərilir...");
      try {
        const summary = await sendParsedItemsToApi(draft.items);
        await chat.sendMessage(summary);
        console.log(`✅ Poll-confirmed draft sent to API for ${userId}`);
      } catch (err) {
        console.error("❌ API send error (poll):", err);
        await chat.sendMessage("❌ API xətası baş verdi. Zəhmət olmasa yenidən cəhd edin.");
      }
      return;
    }

    // ── "❌ Ləğv et" ───────────────────────────────────────────────────────
    if (selectedOptions.includes("❌ Ləğv et")) {
      pendingDrafts.delete(userId);
      pollToUser.delete(pollMsgId);
      await chat.sendMessage("🚫 Qəbz ləğv edildi. Yeni qəbz göndərə bilərsiniz.");
      console.log(`🚫 Poll-cancelled draft for ${userId}`);
    }
  } catch (err) {
    console.error("❌ Error handling vote_update:", err);
  }
});

// ─── Incoming Message Handler ─────────────────────────────────────────────────

/** Build the confirmation prompt shown after every draft update. */
function draftPrompt(editableText, count) {
  return (
    `📋 *Aşkar edilən məhsullar (${count} ədəd):*\n\n` +
    `${editableText}\n\n` +
    `✏️ Düzəliş: sətir nömrəsini yazın, sonra yeni dəyər\n` +
    `_Nümunə: *2 sosiska seher 300gr 55 manat*_\n\n` +
    `⬇️ Aşağıdakı sorğuda seçim edin və ya *ok* / *ləğv* yazın`
  );
}

/**
 * Send the item list + a confirmation Poll.
 * Returns the poll message so its ID can be stored.
 */
async function sendDraftWithPoll(chatId, editableText, count) {
  const listMsg  = draftPrompt(editableText, count);
  const chat     = await client.getChatById(chatId);
  await chat.sendMessage(listMsg);

  const poll = new Poll(
    `📦 ${count} məhsul hazırdır. Nə edək?`,
    ["✅ Göndər", "❌ Ləğv et"],
    { allowMultipleAnswers: false },
  );
  const pollMsg = await chat.sendMessage(poll);
  return pollMsg;
}

client.on("message", async (message) => {
  try {

    const senderInfo = {
      from: message.from,            // WhatsApp ID (could be LID)
      pushName: message._data?.notifyName || "N/A", // Display name if available
      number: message._data?.id?.user || "N/A",     // Phone number part if exists
    };
    console.log("📩 Incoming message from:", senderInfo); // <-- log sender info

    if (!ALLOWED_CONTACTS.has(senderInfo.pushName)) {
      console.log(`🚫 Ignored message from ${message.from}`);
      return;
    }

    const userId   = message.from;
    // Strip invisible Unicode characters (zero-width spaces, joiners, etc.)
    // that WhatsApp mobile keyboards can inject.
    const bodyTrim = (message.body || "").replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "").trim();
    const bodyLow  = bodyTrim.toLowerCase();
    const hasDraft = pendingDrafts.has(userId);

    // ── Help command ─────────────────────────────────────────────────────────
    if (["!help", "!kömək"].includes(bodyLow)) {
      await message.reply(`🤖 *Qəbz Oxuyan Bot*

*Necə istifadə edilir:*
1. Qəbz şəklini göndərin — bot emal edəcək
2. Mətn formatında qəbz göndərin

*Mətn qəbzi nümunəsi:*
  xlor 3kg 100 manat
  sosiska 300gr 50 manat
  pepsi 12 1 manat

*Təsdiq addımı:*
  • Bot nömrəli siyahı göstərəcək
  • Düzəliş: sətir nömrəsi + yeni dəyər yazın
    _Nümunə: 2 sosiska seher 300gr 55 manat_
  • *ok* / *bəli* yazın → API-yə göndər
  • *ləğv* / *xeyr* yazın → imtina

Sualınız varsa *!help* yazın.`);
      return;
    }

    // ── Confirmation: "ok" / "bəli" / "göndər" ──────────────────────────────
    if (hasDraft && ["ok", "bəli", "gonder", "göndər", "yes"].includes(bodyLow)) {
      const draft = pendingDrafts.get(userId);
      pendingDrafts.delete(userId);

      await message.reply("📡 Məhsullar API-yə göndərilir...");

      try {
        const summary = await sendParsedItemsToApi(draft.items);
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

    // ── Inline / batch line-edit ─────────────────────────────────────────────
    // Single line:  "2 Pepsi Cola 1 lt*12 8.4kg 1.04 manat"
    // Multi-line:   "1. name qty price\n2. name qty price\n..."  (full list paste)
    if (hasDraft) {
      const isMultiLine = bodyTrim.includes("\n");
      const lineEditMatch = !isMultiLine && bodyTrim.match(/^(\d+)\.?\s+(.+)$/s);

      // ── Multi-line batch edit ──────────────────────────────────────────────
      if (isMultiLine) {
        const draft  = pendingDrafts.get(userId);
        const result = applyBatchEdit(draft.items, bodyTrim);

        if (result.ok) {
          // Clean up stale poll
          if (draft.pollId) pollToUser.delete(draft.pollId);

          pendingDrafts.set(userId, { items: result.items, editableText: result.editableText, source: draft.source, pollId: null });
          console.log(`✏️ Batch edit: lines [${result.changed.join(", ")}] updated for ${userId}`);

          const header = result.errors.length > 0
            ? `✏️ *${result.changed.length} sətir yeniləndi* (${result.errors.length} xəta):\n${result.errors.join("\n")}\n`
            : `✏️ *${result.changed.length} sətir yeniləndi:*`;
          await message.reply(header);
          const pollMsg = await sendDraftWithPoll(userId, result.editableText, result.items.length);
          pendingDrafts.get(userId).pollId = pollMsg.id._serialized;
          pollToUser.set(pollMsg.id._serialized, userId);
          return;
        }

        // result.error === "mixed" means some lines have numbers, some don't
        // → fall through to the other handlers (might be a fresh receipt)
        if (result.error !== "mixed") {
          // All lines had numbers but none parsed — report errors
          await message.reply(result.errors?.join("\n") || "❌ Batch düzəliş uğursuz oldu.");
          return;
        }
        // else: fall through
      }

      // ── Single-line edit ───────────────────────────────────────────────────
      if (lineEditMatch) {
        const lineNum  = parseInt(lineEditMatch[1], 10);
        const lineText = lineEditMatch[2].trim();
        const draft    = pendingDrafts.get(userId);

        console.log(`✏️ Line-edit attempt: line=${lineNum}, text="${lineText}", draft items=${draft.items.length}`);

        const result = applyLineEdit(draft.items, lineNum, lineText);

        if (!result.ok) {
          await message.reply(result.error);
          return;
        }

        console.log(`✏️ Line-edit success: result items=${result.items.length}`);

        // Remove old poll mapping (it's now stale)
        if (draft.pollId) pollToUser.delete(draft.pollId);

        pendingDrafts.set(userId, { items: result.items, editableText: result.editableText, source: draft.source, pollId: null });
        console.log(`✏️ Line ${lineNum} updated in draft for ${userId}`);

        await message.reply(`✏️ *${lineNum}-ci sətir yeniləndi:*`);
        const pollMsg = await sendDraftWithPoll(userId, result.editableText, result.items.length);
        pendingDrafts.get(userId).pollId = pollMsg.id._serialized;
        pollToUser.set(pollMsg.id._serialized, userId);
        return;
      }
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

      pendingDrafts.set(userId, { items, editableText, source: "image", pollId: null });
      console.log(`📝 Image draft stored for ${userId} (${items.length} items)`);
      const pollMsg = await sendDraftWithPoll(userId, editableText, items.length);
      pendingDrafts.get(userId).pollId = pollMsg.id._serialized;
      pollToUser.set(pollMsg.id._serialized, userId);
      return;
    }

    // ── Edited draft: user resends a full text receipt while draft is pending ─
    if (hasDraft && isTextReceipt(bodyTrim)) {
      const { items, editableText } = parseTextReceiptWithPreview(bodyTrim);

      if (items.length === 0) {
        await message.reply("⚠️ Göndərdiyiniz mətn qəbz kimi tanınmadı. Formatı yoxlayın.\n\nMövcud siyahı hələ gözləyir. *ok* / *ləğv* yazın.");
        return;
      }

      pendingDrafts.set(userId, { items, editableText, source: "text", pollId: null });
      console.log(`✏️ Draft replaced for ${userId} (${items.length} items)`);
      const pollMsg = await sendDraftWithPoll(userId, editableText, items.length);
      pendingDrafts.get(userId).pollId = pollMsg.id._serialized;
      pollToUser.set(pollMsg.id._serialized, userId);
      return;
    }

    // ── Fresh text receipt (no pending draft) ────────────────────────────────
    if (isTextReceipt(bodyTrim)) {
      console.log(`📝 Received text receipt from ${userId}`);
      await message.reply("📝 Mətn qəbzi alındı. Emal olunur...");

      const { items, editableText } = parseTextReceiptWithPreview(bodyTrim);

      if (items.length === 0) {
        await message.reply("⚠️ Heç bir məhsul aşkar edilmədi. Formatı yoxlayın.");
        return;
      }

      pendingDrafts.set(userId, { items, editableText, source: "text", pollId: null });
      console.log(`📝 Text draft stored for ${userId} (${items.length} items)`);
      const pollMsg = await sendDraftWithPoll(userId, editableText, items.length);
      pendingDrafts.get(userId).pollId = pollMsg.id._serialized;
      pollToUser.set(pollMsg.id._serialized, userId);
      return;
    }

    // ── Unrecognised message while draft is pending ──────────────────────────
    if (hasDraft) {
      const draft = pendingDrafts.get(userId);
      await message.reply(
        `⚠️ Mesaj tanınmadı. Mövcud siyahı hələ gözləyir (${draft.items.length} məhsul).\n\n` +
        `Sorğuda seçim edin və ya *ok* / *ləğv* yazın.\n` +
        `Düzəliş üçün: _2 sosiska 300gr 55 manat_`
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
