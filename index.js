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
        const CACHE_NAME = 'anurags-gpt-v3-pro';
        self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add('/'))); });
        self.addEventListener('activate', event => { event.waitUntil(clients.claim()); });
        self.addEventListener('fetch', event => { event.respondWith(fetch(event.request).catch(() => caches.match('/'))); });
    `);
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      "name": "Anurag's GPT", "short_name": "AnuragGPT", "description": "Anurag's Pro AI Assistant",
      "start_url": "/", "display": "standalone", "background_color": "#0d1117", "theme_color": "#0d1117",
      "orientation": "portrait",
      "icons": [
        { "src": "/icon.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
        { "src": "/icon.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
      ]
    });
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

// --- GETIMG PROXY (PHOTO EDITING) ---
app.post('/api/edit-image', async (req, res) => {
    try {
        const correctPassword = cleanApiKey('APP_PASSWORD', 'APPPASSWORD');
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized" });
        const { imageBase64, prompt } = req.body;
        if (!imageBase64 || !prompt) return res.status(400).json({ error: "Data missing." });
        const cleanKey = cleanApiKey('GETIMG_API_KEY', 'GETIMGAPIKEY');
        if (!cleanKey) return res.status(500).json({ error: "Getimg API Key missing!" });
        const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        const response = await fetch("https://api.getimg.ai/v1/essential/image-to-image", {
            method: "POST",
            headers: { "Authorization": `Bearer ${cleanKey}`, "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ image: base64Data, prompt: prompt, output_format: "jpeg", strength: 0.6 })
        });
        if (!response.ok) { const errText = await response.text(); throw new Error(`API Error ${response.status}: ${errText.substring(0, 100)}`); }
        const data = await response.json();
        res.json({ success: true, image: `data:image/jpeg;base64,${data.image}` });
    } catch (error) { console.error("Edit Error:", error.message); res.status(500).json({ error: error.message }); }
});

// --- MAIN CHAT ENGINE ---
app.post('/api/chat', async (req, res) => {
    try {
        const correctPassword = cleanApiKey('APP_PASSWORD', 'APPPASSWORD');
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized" });

        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid format." });

        const cleanKey = cleanApiKey('OPENROUTER_API_KEY', 'OPENROUTERAPIKEY');
        if (!cleanKey) return res.status(500).json({ error: "OpenRouter API Key missing!" });

        const myCustomIdentity = `You are Anurag's GPT, a professional, highly intelligent AI assistant. 
Formatting Rules:
1. EMOJIS: Use relevant emojis at the start of major section headings.
2. MATH: For mathematical expressions, you MUST use LaTeX formatting enclosed in dollar signs.
3. IMAGES: If asked to generate an image, use this EXACT markdown format: ![Image](https://image.pollinations.ai/prompt/detailed%20description%20with%20spaces). Do NOT put it in a code block.`;
        
        if (messages.length > 0) {
            const lastMessageIndex = messages.length - 1;
            if (messages[lastMessageIndex].role === 'user') {
                 if (typeof messages[lastMessageIndex].content === 'string') {
                    messages[lastMessageIndex].content = `[SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUSER REQUEST: ${messages[lastMessageIndex].content}`;
                 } else if (Array.isArray(messages[lastMessageIndex].content)) {
                     let textObj = messages[lastMessageIndex].content.find(c => c.type === 'text');
                     if (textObj) textObj.text = `[SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUSER REQUEST: ${textObj.text}`;
                 }
            }
        }

        const autoModels = ["openrouter/auto", "openrouter/free"];
        let response = null; let errorLogs = [];
        for (const currentModel of autoModels) {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${cleanKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://anurags-gpt.vercel.app", "X-Title": "Anurag's GPT" },
                body: JSON.stringify({ model: currentModel, messages: messages, stream: true })
            });
            if (response.ok) break;
            else { let errText = `HTTP ${response.status}`; try { errText = (await response.json()).error?.message || errText; } catch(e) {} errorLogs.push(`${currentModel}: ${errText}`); }
        }

        if (!response || !response.ok) return res.status(response ? response.status : 500).json({ error: "Routing Failed.\n" + errorLogs.join("\n") });

        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders(); 
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
            if (typeof res.flush === 'function') res.flush(); 
        }
        res.end();
    } catch (error) { if (!res.headersSent) res.status(500).json({ error: "Server Error." }); else res.end(); }
});

app.use((err, req, res, next) => { res.status(500).send('Broken!'); });
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => { console.log(`🚀 Server running on port ${port}!`); });
module.exports = app;