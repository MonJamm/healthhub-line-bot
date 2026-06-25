const express = require('express');
const { middleware, messagingApi } = require('@line/bot-sdk');
const { GoogleGenAI } = require('@google/genai');

const app = express();

// 1. โหลดและตรวจสอบ Config จาก Environment Variables
const config = {
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!config.channelAccessToken || !config.channelSecret || !GEMINI_API_KEY) {
  console.error('Error: กรุณาตั้งค่า LINE_TOKEN, LINE_SECRET และ GEMINI_API_KEY ใน Environment Variables ให้ครบถ้วน');
  process.exit(1);
}

// 2. Initial LINE Client และ Gemini SDK
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken
});
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// 3. รายการคำสั่งที่ต้องหยุดทำงานทันที (CRITICAL SYSTEM FILTER)
// เพื่อปล่อยให้ Rich Menu หรือระบบอื่นของ LINE OA จัดการแทน
const filterKeywords = [
  "โรคทางเพศสัมพันธ์", 
  "การป้องกันโรค", 
  "รู้ทันท้อง", 
  "ยาเสพติด", 
  "คำถามว้าวุ่น"
];

// 4. ฟังก์ชันหลักสำหรับจัดการ Events จาก LINE
async function handleEvent(event) {
  // สนใจเฉพาะข้อความที่เป็น Text เท่านั้น
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userText = event.message.text.trim();

  // --- CRITICAL SYSTEM FILTER ---
  // ถ้าเจอคำในหมวดหมู่ที่กำหนด ให้หยุดการทำงาน (Return เงียบๆ เพื่อไปตอบ 200 OK)
  if (filterKeywords.some(keyword => userText.includes(keyword))) {
    console.log(`[Filter] ตรวจพบคำสำคัญ "${userText}": หยุดการทำงานเพื่อให้ Rich Menu ทำงานแทน`);
    return null;
  }

  // --- โหมดเปิดการสนทนา ---
  if (userText === "คุยกับพี่หมี AI") {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: 'พี่หมีสแตนด์บายแล้วครับ! มีอะไรอยากระบายหรือเล่าให้พี่หมีฟัง พิมพ์มาได้เลยนะ พี่หมีพร้อมรับฟังเสมอ ทุกเรื่องที่คุยกันเป็นความลับแน่นอนครับ 🧸'
      }]
    });
  }

  // --- โหมดสุ่มคำคมฮีลใจด้วย Gemini ---
  if (userText === "คำคมฮีลใจ") {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'ขอคำคมฮีลใจ ให้พลังบวกสั้นๆ สำหรับวัยรุ่นที่กำลังเหนื่อยหรือท้อแท้ เอาแบบอบอุ่น ฟีลเพื่อนเตือนสติ ความยาวแค่ 1 ประโยคสั้นๆ เท่านั้น ไม่ต้องมีคำเกริ่นนำใดๆ ทั้งสิ้น และลงท้ายด้วยอีโมจิที่เข้ากัน',
      });

      const quote = response.text ? response.text.trim() : "เหนื่อยก็พักนะ พี่หมีเป็นกำลังใจให้เสมอครับ 🔋";

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: quote }]
      });
    } catch (error) {
      console.error('Gemini API Error:', error);
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: 'พี่หมีขอเวลาคิดแป๊บน้าา ตอนนี้สมองเบลอไปหมดแล้ว 🧸' }]
      });
    }
  }

  // --- คำสั่งอื่นๆ นอกเหนือจากเงื่อนไข (หยุดทำงานตามเงื่อนไข CRITICAL) ---
  console.log(`[Filter] ข้อความ "${userText}" ไม่ตรงกับเงื่อนไขที่กำหนด: หยุดทำงานเพื่อให้ระบบหลักทำงาน`);
  return null;
}

// 5. Routing สำหรับ Webhook
app.post('/webhook', middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(() => res.status(200).send('OK')) // ส่ง 200 OK เสมอเพื่อบอก LINE Platform ว่าได้รับข้อมูลแล้ว
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(500).end();
    });
});

// 6. Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`พี่หมี AI Webhook กำลังรันที่พอร์ต ${PORT}`);
});
