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

// 3. Object สำหรับเก็บสถานะโหมดแชทของผู้ใช้ (แยกตาม userId ของ LINE)
const userStates = {};

// 4. รายการคำสั่งที่ต้องหยุดทำงานทันที (CRITICAL SYSTEM FILTER)
const filterKeywords = [
  "โรคทางเพศสัมพันธ์", 
  "การป้องกันโรค", 
  "รู้ทันท้อง", 
  "ยาเสพติด", 
  "คำถามว้าวุ่น"
];

// 5. System Prompt หลักสำหรับ "พี่หมี AI" ในโหมดเปิดการสนทนา
const SYSTEM_PROMPT = `คุณคือ "พี่หมี AI" เจ้าหน้าที่สาธารณสุขสุดใจดี อ่อนโยน และเข้าใจวัยรุ่น ประจำ LINE OA โครงการวัยรุ่นวัยใส ของโรงพยาบาลส่งเสริมสุขภาพตำบล (รพ.สต.)

สไตล์การพูดคุย (Tone of Voice):
- ใช้ภาษาเป็นกันเอง อ่อนโยน ปลอบโยน ไม่ตัดสิน ไม่ดุดัน ไม่สั่งสอนแบบผู้ใหญ่
- แทนตัวเองว่า "พี่หมี" และแทนผู้ใช้วัยรุ่นว่า "เธอ" หรือ "น้อง"
- ใช้温馨อีโมจิบ้างตามความเหมาะสม (เช่น 🧸, 💖, 🍃, 🔋)
- ย้ำเสมอว่า "ทุกอย่างที่คุยกับพี่หมีเป็นความลับนะ ไม่ต้องกังวลเลย"

ขอบเขตความรู้และหน้าที่ (Scope of Work):
1. ให้คำปรึกษาและข้อมูลที่ถูกต้องเกี่ยวกับ โรคติดต่อทางเพศสัมพันธ์และการป้องกัน (ถุงยางอนามัย), ภัยของสารเสพติด พร้อมวิธีปฏิเสธเพื่อน, ปัญหาสุขภาพจิต (ความเครียด, ดิ่ง, ซึมเศร้า) โดยเน้นการรับฟังและฮีลใจ
2. ข้อมูลบริการของ รพ.สต. ในพื้นที่: แจกถุงยางอนามัยและยาเม็ดคุมกำเนิด "ฟรี" สำหรับวัยรุ่น เดินเข้ามาขอรับได้เลยที่ รพ.สต. ในวันจันทร์ - ศุกร์ เวลา 08.30 - 16.30 น. (เว้นวันหยุดราชการ)

ข้อจำกัดสำคัญ (Guardrails):
- ห้ามวินิจฉัยโรคเองเด็ดขาด ห้ามจ่ายยาหรือสั่งยา
- หากน้องพิมพ์คำว่า "อยากตาย" "ทำร้ายตัวเอง" ให้แสดงความห่วงใยอย่างที่สุด และส่งข้อความนี้ปิดท้ายทันที: "พี่หมีอยู่ตรงนี้นะ แต่อยากให้อุ่นใจขึ้น ลองโทรคุยกับสายด่วนสุขภาพจิต 1323 (โทรฟรี 24 ชม.) หรือกดปุ่ม 'ปรึกษาเจ้าหน้าที่' เพื่อคุยกับพี่ ๆ อนามัยคนจริง ๆ ได้เลยนะ ทุกอย่างเป็นความลับแน่นอนครับ 🧸"`;

// 6. ฟังก์ชันหลักสำหรับจัดการ Events จาก LINE
async function handleEvent(event) {
  // สนใจเฉพาะข้อความที่เป็น Text และมีข้อมูลผู้ใช้ (userId) เท่านั้น
  if (event.type !== 'message' || event.message.type !== 'text' || !event.source.userId) {
    return null;
  }

  const userId = event.source.userId;
  const userText = event.message.text.trim();

  // ปรับสถานะเริ่มต้นหากผู้ใช้คนนี้ยังไม่เคยอยู่ในระบบ
  if (!userStates[userId]) {
    userStates[userId] = 'OFF';
  }

  // --- CRITICAL SYSTEM FILTER ---
  // ถ้าเจอคำในหมวดหมู่ที่กำหนด ให้หยุดการทำงาน (Return เพื่อไปตอบ 200 OK)
  if (filterKeywords.some(keyword => userText.includes(keyword))) {
    console.log(`[Filter] ผู้ใช้ ${userId} พิมพ์ "${userText}": หยุดทำงานเพื่อให้ Rich Menu จัดการ`);
    return null;
  }

  // --- โหมดสุ่มคำคมฮีลใจด้วย Gemini (ทำงานได้ตลอดเวลา โดยไม่ต้องสนใจสถานะ) ---
  if (userText === "คำคมฮีลใจ") {
    try {
      // จุดแก้ไข 1: เปลี่ยนมาใช้โมเดล gemini-1.5-flash เพื่อโควตา Free Tier ที่เสถียรกว่า
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: 'จงแต่งคำคมฮีลใจ ให้พลังบวก 1 ข้อความ ความยาวสั้นๆ แค่ 2-3 ประโยค เน้นความสดใส ร่าเริง และใส่อีโมจิเยอะๆ เงื่อนไขสำคัญที่สุด: ห้ามมีคำเกริ่นนำ คำตอบรับ หรือคำอธิบายใดๆ ทั้งสิ้น ให้ตอบกลับเฉพาะเนื้อหาของคำคมเพียวๆ เท่านั้น',
        config: {
          maxOutputTokens: 400 
        }
      });

      const quote = response.text ? response.text.trim() : "เหนื่อยก็พักนะ พี่หมีเป็นกำลังใจให้เสมอครับ 🔋";

      return await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: quote }]
      });
    } catch (error) {
      console.error('Gemini API Error (คำคม):', error);
      
      // มีคลังคำคมสำรองเผื่อไว้ กรณีที่โควตารวมรายวัน (TPD) ของสายฟรีหมด บอทจะได้ไม่เงียบใส่ผู้ใช้
      const backupQuotes = [
        "วันนี้อาจจะเหนื่อยหน่อย แต่เธอเก่งมากแล้วนะที่ผ่านมันมาได้ พักผ่อนให้เต็มที่นะคนเก่ง พี่หมีอยู่ตรงนี้เสมอครับ 🧸💖",
        "ท้องฟ้าแต่ละวันยังสีไม่เหมือนกันเลย วันนี้ไม่สดใสก็ไม่เป็นไรนะ พรุ่งนี้ค่อยเริ่มใหม่ พี่หมีส่งพลังใจให้เต็มร้อยเลย! 🍃🔋",
        "อย่าลืมใจดีกับตัวเองเยอะๆ นะครับ วันนี้ทำดีที่สุดแล้ว ทิ้งเรื่องเครียดๆ ไว้ก่อน แล้วมาเติมพลังกันใหม่นะ 🧸✨",
        "ไม่ว่าเจออะไรมาจนรู้สึกเหนื่อยล้า หันมาเมื่อไหร่ก็เจอพี่หมีเสมอนะ แวะมาเติมพลังใจได้ตลอดเลยนะฮะ 🔋💖"
      ];
      const randomIndex = Math.floor(Math.random() * backupQuotes.length);
      
      return await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: backupQuotes[randomIndex] }]
      });
    }
  }

  // --- เงื่อนไขสลับโหมดเปิดการสนทนา [CHAT_MODE = ON] ---
  if (userText === "คุยกับพี่หมี AI") {
    userStates[userId] = 'ON';
    console.log(`[State] ผู้ใช้ ${userId} เปลี่ยนสถานะเป็น ON`);
    return await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: 'พี่หมีสแตนด์บายแล้วครับ! มีอะไรอยากระบายหรือเล่าให้พี่หมีฟัง พิมพ์มาได้เลยนะ พี่หมีพร้อมรับฟังเสมอ ทุกเรื่องที่คุยกันเป็นความลับแน่นอนครับ 🧸'
      }]
    });
  }

  // --- เงื่อนไขสลับโหมดปิดการสนทนา [CHAT_MODE = OFF] ---
  if (userText === "บ๊ายบายพี่หมี") {
    userStates[userId] = 'OFF';
    console.log(`[State] ผู้ใช้ ${userId} เปลี่ยนสถานะเป็น OFF`);
    return await client.replyMessage({
      replyToken: event.replyToken,
      messages: [{
        type: 'text',
        text: 'รับทราบครับ! ไว้เหนื่อยเมื่อไหร่แวะมาคุยกันใหม่นะ พี่หมีส่งต่อให้พี่ๆ เจ้าหน้าที่ดูแลต่อแล้วครับ บ๊ายบายครับ 🔋'
      }]
    });
  }

  // --- กรณีที่อยู่ในโหมดสนทนา [CHAT_MODE === ON] และไม่ใช่คำสั่งเปิด/ปิด/คำคม ---
  if (userStates[userId] === 'ON') {
    try {
      // จุดแก้ไข 2: เปลี่ยนมาใช้โมเดล gemini-1.5-flash ในระบบแชทหลักด้วยเช่นกัน
      const response = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: userText,
        config: {
          systemInstruction: SYSTEM_PROMPT
        }
      });

      const aiReply = response.text ? response.text.trim() : "พี่หมีกำลังฟังอยู่นะครับ เล่าต่อได้เลยนะ 🧸";

      return await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: aiReply }]
      });
    } catch (error) {
      console.error('Gemini API Error (แชท):', error);
      return await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: 'ขออภัยครับ พี่หมีกำลังมึนงงเล็กน้อย พิมพ์มาใหม้อีกครั้งนะ 🧸' }]
      });
    }
  }

  // --- คำสั่งอื่นๆ ขณะที่สถานะเป็น OFF (หยุดทำงานเพื่อให้ระบบหลักทำงาน) ---
  console.log(`[Filter] ผู้ใช้ ${userId} ส่งข้อความ "${userText}" นอกเงื่อนไขแชท: หยุดทำงานเพื่อให้ระบบหลักทำงาน`);
  return null;
}

// 7. Routing สำหรับ Webhook
app.post('/webhook', middleware(config), (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then(() => res.status(200).send('OK'))
    .catch((err) => {
      console.error('Webhook Error:', err);
      res.status(500).end();
    });
});

// 8. Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`พี่หมี AI Webhook กำลังรันที่พอร์ต ${PORT}`);
});
