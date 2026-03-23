# 🤖 WhatsApp Qəbz Oxuyan Bot / WhatsApp Receipt Reader Bot

Bu bot WhatsApp vasitəsilə göndərilən qəbz şəkillərini oxuyur və mətn formatında qaytarır. Azərbaycan dilində qəbzləri tanımaq üçün optimallaşdırılmışdır.

This bot reads receipt images sent via WhatsApp and returns them as formatted text. Optimized for Azerbaijani language receipts.

## ✨ Xüsusiyyətlər / Features

- 📸 Qəbz şəkillərini avtomatik tanıma / Automatic receipt image recognition
- 🇦🇿 Azərbaycan dili dəstəyi / Azerbaijani language support
- 📝 Yaxşı formatlaşdırılmış mətn cavabı / Well-formatted text response
- 🔄 Real-time emal / Real-time processing
- 💬 WhatsApp Web.js əsaslı / Based on WhatsApp Web.js

## 📋 Tələblər / Requirements

- Node.js (v16 və ya daha yeni / v16 or newer)
- npm və ya yarn / npm or yarn
- WhatsApp hesabı / WhatsApp account

## 🚀 Quraşdırma / Installation

1. **Layihəni yükləyin / Clone the repository:**

   ```bash
   git clone <repository-url>
   cd WhatsappReceptReader
   ```

2. **Asılılıqları quraşdırın / Install dependencies:**

   ```bash
   npm install
   ```

3. **Environment faylını yaradın / Create environment file:**

   ```bash
   cp .env.example .env
   ```

4. **Botu başladın / Start the bot:**
   ```bash
   npm start
   ```

## 📱 İstifadə / Usage

1. **İlk dəfə başlatma / First time setup:**
   - Botu işə saldıqdan sonra terminalda QR kod görünəcək
   - WhatsApp tətbiqinizdə **Bağlı Cihazlar** bölməsinə daxil olun
   - QR kodu skan edin
   - Bot hazır olduqda "✅ WhatsApp Receipt Reader Bot is ready!" mesajını görəcəksiniz

2. **Qəbz göndərmə / Sending receipts:**
   - Bota qəbz şəklini göndərin
   - Bot şəkli emal edəcək və mətn formatında cavab verəcək

3. **Kömək almaq / Getting help:**
   - Bota `!help` və ya `!kömək` yazın

## 🎯 Tövsiyələr / Tips for Best Results

✅ Şəkil aydın və oxunaqlı olsun / Image should be clear and readable
✅ Yaxşı işıqlandırma / Good lighting
✅ Bütün qəbz çərçivədə olsun / Entire receipt in frame
✅ Düz bucaq altında çəkilmiş şəkil / Photo taken at straight angle

## 📁 Layihə Strukturu / Project Structure

```
WhatsappReceptReader/
├── index.js                    # Əsas bot faylı / Main bot file
├── services/
│   ├── imageProcessor.js       # Şəkil emalı və OCR / Image processing and OCR
│   └── textFormatter.js        # Mətn formatlaşdırma / Text formatting
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## 🛠️ Texnologiyalar / Technologies

- **whatsapp-web.js** - WhatsApp Web API
- **Tesseract.js** - OCR mühərriki / OCR engine
- **Sharp** - Şəkil emalı / Image processing
- **Node.js** - Runtime environment

## 📝 OCR Dəstəyi / OCR Support

Bot Azərbaycan və İngilis dillərini dəstəkləyir (aze+eng). Tesseract.js avtomatik olaraq lazımi dil fayllarını yükləyir.

The bot supports Azerbaijani and English languages (aze+eng). Tesseract.js automatically downloads the required language files.

## 🔧 Konfiqurasiya / Configuration

`.env` faylında aşağıdakı parametrləri tənzimləyə bilərsiniz:

You can configure the following parameters in the `.env` file:

- `NODE_ENV` - Mühit (development/production)
- `LOG_LEVEL` - Log səviyyəsi (debug/info/warn/error)

## 🐛 Problemlər / Troubleshooting

**Bot QR kod göstərmir / Bot doesn't show QR code:**

- Əmin olun ki, bütün asılılıqlar quraşdırılıb / Make sure all dependencies are installed
- `node_modules` qovluğunu silib yenidən `npm install` edin

**OCR düzgün oxumur / OCR not reading correctly:**

- Daha aydın şəkil göndərin / Send a clearer image
- Şəkil ölçüsünün kifayət qədər böyük olduğundan əmin olun
- Işıqlandırmanı yaxşılaşdırın / Improve lighting

**Bot cavab vermir / Bot not responding:**

- İnternet bağlantısını yoxlayın / Check internet connection
- Botu yenidən başladın / Restart the bot
- WhatsApp Web bağlantısını yoxlayın / Check WhatsApp Web connection

## 📄 Lisenziya / License

ISC

## 🤝 Töhfə / Contributing

Pull request-lər xoş qarşılanır! / Pull requests are welcome!

## 📞 Əlaqə / Contact

Suallarınız varsa issue açın və ya pull request göndərin.

For questions, please open an issue or submit a pull request.

---

**Qeyd / Note:** Bu bot yalnız şəxsi istifadə üçündür. WhatsApp-ın istifadə şərtlərinə əməl edin.

**Note:** This bot is for personal use only. Please comply with WhatsApp's terms of service.
