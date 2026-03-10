const express = require('express');
const app = express();
app.use(express.json());

// ============================================================
// НАЛАШТУВАННЯ — замініть на свої значення
// ============================================================
const CONFIG = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'uiaba_verify_token_2024',
  PAGE_ACCESS_TOKEN: process.env.PAGE_ACCESS_TOKEN || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
};

// Системний промпт — особистість вашого AI агента
const SYSTEM_PROMPT = `Ти — AI асистент Інституту ABA (UIABA), акредитованого центру підготовки поведінкових аналітиків в Україні.

Твої задачі:
- Відповідати на запитання про програми підготовки поведінкових аналітиків (BCBA, BCaBA, RBT)
- Надавати інформацію про курси CEU (продовження освіти)
- Консультувати щодо професійної літератури з ABA
- Допомагати абітурієнтам обрати програму навчання
- Відповідати на питання про ABA терапію та аутизм

Правила спілкування:
- Спілкуйся українською мовою (якщо людина пише російською — відповідай російською)
- Будь ввічливим, професійним та теплим
- Давай чіткі та корисні відповіді
- Якщо не знаєш точної відповіді — запропонуй зв'язатися з командою інституту
- Не давай медичних рекомендацій конкретним людям
- Заохочуй записатися на консультацію або курс

Контакти інституту для складних питань: instituteaba.ua@gmail.com`;

// ============================================================
// WEBHOOK ВЕРИФІКАЦІЯ (Meta перевіряє сервер)
// ============================================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === CONFIG.VERIFY_TOKEN) {
    console.log('✅ Webhook верифіковано!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Верифікація не пройшла');
    res.sendStatus(403);
  }
});

// ============================================================
// ОТРИМАННЯ ПОВІДОМЛЕНЬ
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Відповідаємо одразу щоб Meta не ретраїла

  const body = req.body;
  if (!body.object) return;

  for (const entry of body.entry || []) {
    // Facebook Messenger
    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (event.message?.text && !event.message.is_echo) {
          await handleMessage(event.sender.id, event.message.text, 'messenger');
        }
      }
    }

    // Instagram Direct Messages
    if (entry.changes) {
      for (const change of entry.changes) {
        const msg = change.value;
        if (change.field === 'messages' && msg?.messages?.[0]?.text) {
          const senderId = msg.messages[0].from.id;
          const text = msg.messages[0].text.body || msg.messages[0].text;
          await handleMessage(senderId, text, 'instagram');
        }
      }
    }
  }
});

// ============================================================
// ОБРОБКА ПОВІДОМЛЕННЯ + CLAUDE AI
// ============================================================
async function handleMessage(senderId, userText, platform) {
  console.log(`📩 [${platform}] від ${senderId}: ${userText}`);

  try {
    // Отримуємо відповідь від Claude
    const aiReply = await getClaudeResponse(userText);
    
    // Відправляємо відповідь
    await sendMessage(senderId, aiReply, platform);
    
    console.log(`✅ Відповідь надіслано: ${aiReply.substring(0, 80)}...`);
  } catch (error) {
    console.error('❌ Помилка:', error.message);
    await sendMessage(senderId, 'Вибачте, виникла технічна помилка. Будь ласка, напишіть нам на instituteaba.ua@gmail.com', platform);
  }
}

// ============================================================
// CLAUDE API
// ============================================================
async function getClaudeResponse(userMessage) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CONFIG.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// ============================================================
// ВІДПРАВКА ПОВІДОМЛЕННЯ
// ============================================================
async function sendMessage(recipientId, text, platform) {
  // Розбиваємо довгі повідомлення (ліміт Meta — 2000 символів)
  const chunks = splitText(text, 1900);
  
  for (const chunk of chunks) {
    const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${CONFIG.PAGE_ACCESS_TOKEN}`;
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: chunk }
      })
    });
    
    // Пауза між чанками
    if (chunks.length > 1) await sleep(500);
  }
}

// ============================================================
// ДОПОМІЖНІ ФУНКЦІЇ
// ============================================================
function splitText(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLength));
    i += maxLength;
  }
  return chunks;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'UIABA Assistant', version: '1.0' });
});

// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 UIABA Bot запущено на порту ${PORT}`);
  console.log(`📌 Webhook URL: https://YOUR-DOMAIN/webhook`);
});
