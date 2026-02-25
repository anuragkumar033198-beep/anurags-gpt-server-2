const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// --- GLOBAL MIDDLEWARE ---
app.use(cors()); 
app.use(express.json({ limit: '50mb' })); // Allows large image uploads

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
      "name": "Anurag's GPT", "short_name": "AnuragGPT", "description": "Anurag's Custom AI Backend",
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
// This guarantees keys work even if Replit removes underscores or adds invisible spaces/newlines
function cleanApiKey(keyWithUnderscores, keyWithoutUnderscores) {
    let raw = process.env[keyWithUnderscores] || process.env[keyWithoutUnderscores] || '';
    let cleaned = raw.replace(/[\r\n\s]+/g, ''); // Destroys all spaces, tabs, and newlines
    if (cleaned.toLowerCase().startsWith('bearer')) {
        cleaned = cleaned.substring(6); // Chops off "bearer" if accidentally included
    }
    return cleaned;
}

// --- SECURITY SYSTEM ---
const failedAttempts = new Map(); 
const bannedIPs = new Set();      
const MAX_ATTEMPTS = 5;
const getIP = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || "Unknown IP";

app.use('/api', (req, res, next) => {
    if (req.path === '/unban') return next(); 
    const ip = getIP(req);
    if (bannedIPs.has(ip)) return res.status(403).json({ error: "BANNED: Your IP has been blocked." });
    next();
});

app.post('/api/verify', async (req, res) => {
    const ip = getIP(req);
    const correctPassword = (process.env.APP_PASSWORD || process.env.APPPASSWORD || '').trim();
    const userPassword = (req.headers['x-app-password'] || '').trim();
    
    if (correctPassword && userPassword !== correctPassword) {
        let attempts = (failedAttempts.get(ip) || 0) + 1;
        failedAttempts.set(ip, attempts);
        if (attempts >= MAX_ATTEMPTS) { bannedIPs.add(ip); return res.status(403).json({ error: "BANNED" }); }
        return res.status(401).json({ error: "Incorrect Password", attemptsLeft: MAX_ATTEMPTS - attempts });
    }
    failedAttempts.delete(ip);
    res.json({ success: true });
});

// --- 1. POLLINATIONS TEXT-TO-IMAGE PROXY ---
app.get('/api/image', async (req, res) => {
    try {
        const correctPassword = (process.env.APP_PASSWORD || process.env.APPPASSWORD || '').trim();
        const userPassword = (req.query.pwd || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).send("Unauthorized App Password");

        const prompt = req.query.prompt;
        const seed = req.query.seed || Math.floor(Math.random() * 1000000); 
        if (!prompt) return res.status(400).send("Prompt is required");

        const cleanKey = cleanApiKey('POLLINATIONS_API_KEY', 'POLLINATIONSAPIKEY');
        if (!cleanKey) return res.status(500).send("Pollinations API Key missing in Vercel Variables");

        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&seed=${seed}`;
        
        const response = await fetch(url, { method: 'GET', headers: { "Authorization": `Bearer ${cleanKey}`, "User-Agent": "Anurags-GPT/1.0" }});
        if (!response.ok) { const errText = await response.text(); return res.status(response.status).send(`Pollinations Error ${response.status}: ${errText.substring(0, 150)}`); }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        if (response.body && typeof response.body.pipe === 'function') { response.body.pipe(res); } 
        else { const arrayBuffer = await response.arrayBuffer(); res.send(Buffer.from(arrayBuffer)); }
    } catch (error) { res.status(500).send(`Server Error: ${error.message}`); }
});

// --- 2. GETIMG IMAGE-TO-IMAGE (PHOTO EDITING) PROXY ---
app.post('/api/edit-image', async (req, res) => {
    try {
        const correctPassword = (process.env.APP_PASSWORD || process.env.APPPASSWORD || '').trim();
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized" });

        const { imageBase64, prompt } = req.body;
        if (!imageBase64 || !prompt) return res.status(400).json({ error: "Image and prompt required." });

        const cleanKey = cleanApiKey('GETIMG_API_KEY', 'GETIMGAPIKEY');
        if (!cleanKey) return res.status(500).json({ error: "Getimg.ai API Key missing in Vercel Variables!" });

        // Strip the HTML data prefix for the API
        const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

        const response = await fetch("https://api.getimg.ai/v1/essential/image-to-image", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${cleanKey}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                image: base64Data,
                prompt: prompt,
                output_format: "jpeg",
                strength: 0.6 // 0.6 is the perfect balance for editing while keeping original structure
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Getimg API Error ${response.status}: ${errText.substring(0, 100)}`);
        }

        const data = await response.json();
        res.json({ success: true, image: `data:image/jpeg;base64,${data.image}` });

    } catch (error) {
        console.error("Edit Image Error:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- 3. MAIN AI CHAT ENGINE (OPENROUTER) ---
app.post('/api/chat', async (req, res) => {
    try {
        const correctPassword = (process.env.APP_PASSWORD || process.env.APPPASSWORD || '').trim();
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized: Invalid Password" });

        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid message format." });

        const cleanKey = cleanApiKey('OPENROUTER_API_KEY', 'OPENROUTERAPIKEY');
        if (!cleanKey) return res.status(500).json({ error: "OpenRouter API Key missing!" });

        const myCustomIdentity = "You are Anurag's GPT, a highly intelligent senior web developer AI assistant created by Anurag. IMAGE GENERATION: If the user asks you to generate, draw, or make an image, reply with this exact markdown format: ![Image](https://gen.pollinations.ai/image/detailed%20description%20of%20image). Replace spaces with %20. Do not put the image link inside a code block.";
        
        if (messages.length > 0) {
            if (typeof messages[0].content === 'string' && !messages[0].content.includes("[STRICT SYSTEM INSTRUCTIONS:")) {
                messages[0].content = `[STRICT SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUser Message: ${messages[0].content}`;
            } else if (Array.isArray(messages[0].content)) {
                let textObj = messages[0].content.find(c => c.type === 'text');
                if (textObj && !textObj.text.includes("[STRICT SYSTEM INSTRUCTIONS:")) textObj.text = `[STRICT SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUser Message: ${textObj.text}`;
            }
        }

        const autoModels = ["openrouter/auto", "openrouter/free"];
        let response = null;
        let errorLogs = [];

        for (const currentModel of autoModels) {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${cleanKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://anurags-gpt.vercel.app", "X-Title": "Anurag's GPT" },
                body: JSON.stringify({ model: currentModel, messages: messages, stream: true })
            });
            if (response.ok) break;
            else { let errText = `HTTP ${response.status}`; try { errText = (await response.json()).error?.message || errText; } catch(e) {} errorLogs.push(`${currentModel}: ${errText}`); }
        }

        if (!response || !response.ok) return res.status(response ? response.status : 500).json({ error: "Auto-Routing Failed.\n\nDiagnostics:\n" + errorLogs.join("\n") });

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