const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// --- GLOBAL MIDDLEWARE ---
app.use(cors()); 
app.use(express.json({ limit: '50mb' })); 

app.use(express.static(path.join(__dirname, 'public'), { index: false })); 
app.use(express.static(__dirname, { index: false })); 

// --- DYNAMIC PWA GENERATORS ---
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        const CACHE_NAME = 'anurags-gpt-v1';
        self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add('/'))); });
        self.addEventListener('activate', event => { event.waitUntil(clients.claim()); });
        self.addEventListener('fetch', event => { event.respondWith(fetch(event.request).catch(() => caches.match('/'))); });
    `);
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      "name": "Anurag's GPT", "short_name": "Anurag's GPT", "description": "Anurag's Custom AI Backend",
      "start_url": "/", "display": "standalone", "background_color": "#0d1117", "theme_color": "#0d1117",
      "orientation": "portrait",
      "icons": [
        { "src": "/icon.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
        { "src": "/icon.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
      ]
    });
});

app.get('/.well-known/assetlinks.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json([{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "android_app", "package_name": "app.vercel.anurags_gpt_server_2.twa", "sha256_cert_fingerprints": [ "D3:D2:E2:85:50:49:89:4D:82:5A:49:AD:A4:14:7D:51:46:E3:61:41:F0:36:F9:B9:93:C0:2F:98:36:D9:0B:08"] } }]);
});

app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
    else if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
    else return res.send(`<h1>✅ Server Online!</h1><p style="color:red;">❌ index.html missing.</p>`);
});

// --- UNIVERSAL KEY SANITIZER ---
function cleanApiKey(keyWithUnderscores, keyWithoutUnderscores) {
    let raw = process.env[keyWithUnderscores] || process.env[keyWithoutUnderscores] || '';
    let cleaned = raw.replace(/[\r\n\s]+/g, ''); 
    if (cleaned.toLowerCase().startsWith('bearer')) { cleaned = cleaned.substring(6); }
    return cleaned;
}

// --- SECURITY SYSTEM & DISCORD WEBHOOK ---
const failedAttempts = new Map(); 
const bannedIPs = new Set();      
const MAX_ATTEMPTS = 5;
const getIP = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || "Unknown IP";

async function notifyDiscord(ip, req) {
    const webhookUrl = cleanApiKey('DISCORD_WEBHOOK_URL', 'DISCORDWEBHOOKURL');
    if (!webhookUrl) return; 
    
    const correctPassword = cleanApiKey('APP_PASSWORD', 'APPPASSWORD');
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const unbanLink = `${protocol}://${host}/api/unban?ip=${ip}&pwd=${encodeURIComponent(correctPassword)}`;

    const payload = {
        embeds: [{
            title: "🚨 Security Alert: IP Banned",
            description: `Someone has triggered the security firewall on your Chatbot.\n\n**IP Address:** \`${ip}\`\n**Reason:** Exceeded ${MAX_ATTEMPTS} failed login attempts.\n\n👉 **[CLICK HERE TO UNBAN THIS IP](${unbanLink})**`,
            color: 16711680,
            timestamp: new Date().toISOString()
        }]
    };

    try { await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } 
    catch (e) { console.error("Discord Webhook Error:", e.message); }
}

app.use('/api', (req, res, next) => {
    if (req.path === '/unban') return next(); 
    const ip = getIP(req);
    if (bannedIPs.has(ip)) return res.status(403).json({ error: "BANNED: Your IP has been blocked." });
    next();
});

app.post('/api/verify', async (req, res) => {
    const ip = getIP(req);
    const correctPassword = cleanApiKey('APP_PASSWORD', 'APPPASSWORD');
    const userPassword = (req.headers['x-app-password'] || '').trim();
    
    if (correctPassword && userPassword !== correctPassword) {
        let attempts = (failedAttempts.get(ip) || 0) + 1;
        failedAttempts.set(ip, attempts);
        
        if (attempts === MAX_ATTEMPTS) { 
            bannedIPs.add(ip); 
            await notifyDiscord(ip, req);
            return res.status(403).json({ error: "BANNED" }); 
        }
        if (attempts > MAX_ATTEMPTS) return res.status(403).json({ error: "BANNED" });
        return res.status(401).json({ error: "Incorrect Password", attemptsLeft: MAX_ATTEMPTS - attempts });
    }
    failedAttempts.delete(ip);
    res.json({ success: true });
});

app.get('/api/unban', (req, res) => {
    const targetIp = req.query.ip;
    const providedPwd = req.query.pwd;
    const correctPassword = cleanApiKey('APP_PASSWORD', 'APPPASSWORD');

    if (!correctPassword || providedPwd !== correctPassword) return res.status(401).send("<h1 style='color:red; text-align:center;'>🚨 Unauthorized Link</h1>");
    if (targetIp) {
        bannedIPs.delete(targetIp); failedAttempts.delete(targetIp);
        return res.send(`<div style="text-align:center; padding: 50px; background:#111827; color:white; height:100vh; font-family:sans-serif;"><h1 style='color:#34d399;'>✅ IP Unbanned</h1><p>The IP <b>${targetIp}</b> has been removed from the blacklist.</p></div>`);
    }
    res.send("<h1>Error</h1><p>No IP provided.</p>");
});

// --- THE SECURE IMAGE PROXY (FOR POLLINATIONS GENERATION) ---
app.get('/api/image', async (req, res) => {
    try {
        const correctPassword = cleanApiKey('APP_PASSWORD', 'APPPASSWORD');
        const userPassword = (req.query.pwd || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).send("Unauthorized App Password");

        const prompt = req.query.prompt;
        const seed = req.query.seed || Math.floor(Math.random() * 1000000); 
        if (!prompt) return res.status(400).send("Prompt is required");

        const cleanKey = cleanApiKey('POLLINATIONS_API_KEY', 'POLLINATIONSAPIKEY');
        if (!cleanKey) return res.status(500).send("API Key missing in Vercel/Replit Variables");

        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&seed=${seed}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: { 
                "Authorization": `Bearer ${cleanKey}`,
                "User-Agent": "Anurags-GPT/1.0"
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).send(`Pollinations Error ${response.status}: ${errText.substring(0, 150)}`);
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        if (response.body && typeof response.body.pipe === 'function') {
            response.body.pipe(res);
        } else {
            const arrayBuffer = await response.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
        }

    } catch (error) {
        res.status(500).send(`Server Error: ${error.message}`);
    }
});

// --- MAIN CHAT ENGINE WITH SMART ROUTING ---
app.post('/api/chat', async (req, res) => {
    try {
        let rawAppKey = process.env.APP_PASSWORD || process.env.APPPASSWORD || '';
        const correctPassword = rawAppKey.replace(/[\r\n\s]+/g, '');
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized: Invalid Password" });

        // FIXED: Now we accept BOTH the messages and the custom system prompt from the frontend!
        const { messages, customSystemPrompt } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid message format." });

        let rawOpenRouter = process.env.OPENROUTER_API_KEY || process.env.OPENROUTERAPIKEY || '';
        let apiKey = rawOpenRouter.replace(/[\r\n\s]+/g, ''); 
        if (apiKey.toLowerCase().startsWith('bearer')) apiKey = apiKey.substring(6);

        if (!apiKey) return res.status(500).json({ error: "API Key missing!" });

        const myCustomIdentity = `You are Anurag's GPT, a highly intelligent senior AI assistant created by Anurag.
Formatting Rules:
1. MATH NOTATION (CRITICAL): Do NOT use LaTeX formatting like $, $$, \\frac, \\rangle, \\alpha, or ^. Instead, you MUST use standard plain-text Unicode mathematical symbols (e.g., ², ³, ×, ÷, ±, °, π) and write equations cleanly so they can be read easily as normal text. Example: Write "x² + y² = z²" instead of "$x^2 + y^2 = z^2$". 
2. AUTOMATIC IMAGES: Whenever explaining a topic, you MUST ALWAYS generate a relevant illustrative image at the VERY TOP of your response. Use EXACTLY this markdown format: ![Image](https://image.pollinations.ai/prompt/highly%20detailed%20visual%20description). Do NOT put the image link inside a code block.
3. EMOJIS: Use emojis at the start of major section headings.
4. YOUR IDENTITY & LOGO: If the user uploads an image of a blue circular icon with a white lightning bolt, DO NOT say it is Discord. You MUST recognize it and proudly declare that it is YOUR logo: The "Anurag's GPT" logo.
5. SMART IMAGE EDITING (FAKE I2I): If the user uploads an image and asks you to edit or change it, act as a professional image generator. Analyze the uploaded image, then create a new image prompt that recreates it BUT includes the requested changes. Generate this new image using the Pollinations markdown: ![Image](https://image.pollinations.ai/prompt/your%20new%20description).`;
        
        // FIXED: Merge the hardcoded identity with the custom user settings prompt seamlessly!
        let combinedInstructions = myCustomIdentity;
        if (customSystemPrompt && typeof customSystemPrompt === 'string' && customSystemPrompt.trim() !== '') {
            combinedInstructions += `\n\nADDITIONAL USER-DEFINED BEHAVIOR (MUST OBEY):\n${customSystemPrompt.trim()}`;
        }

        let hasImage = false;
        if (messages.length > 0) {
            const lastMessageIndex = messages.length - 1;
            const lastMsg = messages[lastMessageIndex];
            
            if (Array.isArray(lastMsg.content)) {
                hasImage = lastMsg.content.some(c => c.type === 'image_url');
                let textObj = lastMsg.content.find(c => c.type === 'text');
                if (textObj) textObj.text = `[STRICT SYSTEM INSTRUCTIONS: ${combinedInstructions}]\n\nUser Message: ${textObj.text}`;
            } else if (typeof lastMsg.content === 'string') {
                lastMsg.content = `[STRICT SYSTEM INSTRUCTIONS: ${combinedInstructions}]\n\nUser Message: ${lastMsg.content}`;
            }
        }

        const autoModels = hasImage 
            ? [
                "google/gemini-2.0-flash-exp:free", 
                "google/gemini-1.5-flash:free",
                "meta-llama/llama-3.2-11b-vision-instruct:free",
                "openrouter/auto"
              ] 
            : [
                "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
                "openrouter/auto", 
                "openrouter/free"
              ];

        let response = null;
        let errorLogs = [];

        for (const currentModel of autoModels) {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://anurags-gpt.vercel.app", "X-Title": "Anurag's GPT" },
                body: JSON.stringify({ model: currentModel, messages: messages, stream: true, max_tokens: 8000 })
            });
            
            if (response.ok) break;
            else { 
                let errText = `HTTP ${response.status}`; 
                try { 
                    const errJson = await response.json(); 
                    errText = errJson.error?.message || errText; 
                } catch(e) {} 
                errorLogs.push(`${currentModel}: ${errText}`); 
            }
        }

        if (!response || !response.ok) {
            return res.status(response ? response.status : 500).json({ error: "AI Engine Failed to process request.\n\nDiagnostics:\n" + errorLogs.join("\n") });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); 
        
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
            if (typeof res.flush === 'function') res.flush(); 
        }
        res.end();
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error." }); else res.end();
    }
});

app.use((err, req, res, next) => { res.status(500).send('Something broke!'); });
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => { console.log(`🚀 Anurag's GPT Backend is running on port ${port}!`); });
module.exports = app;