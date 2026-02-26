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
      "name": "Anurag's GPT", "short_name": "AnuragGPT", "description": "Anurag's Custom AI Backend",
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
    res.json([{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "android_app", "package_name": "app.vercel.anurags_gpt_server_2.twa", "sha256_cert_fingerprints": ["PASTE_YOUR_SHA256_FINGERPRINT_HERE"] } }]);
});

app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
    else if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
    else return res.send(`<h1>✅ Server Online!</h1><p style="color:red;">❌ index.html missing.</p>`);
});

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

// --- THE SECURE IMAGE PROXY (UNTOUCHED WORKING CODE) ---
app.get('/api/image', async (req, res) => {
    try {
        const correctPassword = (process.env.APP_PASSWORD || process.env.APPPASSWORD || '').trim();
        const userPassword = (req.query.pwd || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).send("Unauthorized App Password");

        const prompt = req.query.prompt;
        const seed = req.query.seed || Math.floor(Math.random() * 1000000); // Receive seed from frontend
        if (!prompt) return res.status(400).send("Prompt is required");

        // CLEAN THE API KEY
        let rawKey = process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONSAPIKEY || '';
        let cleanKey = rawKey.replace(/[\r\n\s]+/g, ''); 
        if (cleanKey.toLowerCase().startsWith('bearer')) cleanKey = cleanKey.substring(6);

        if (!cleanKey) return res.status(500).send("API Key missing in Vercel/Replit Variables");

        // UPDATED URL STRUCTURE: Including model=flux and seed
        const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&seed=${seed}`;
        
        // Use Node-native fetch for streaming
        const response = await fetch(url, {
            method: 'GET',
            headers: { 
                "Authorization": `Bearer ${cleanKey}`,
                "User-Agent": "Anurags-GPT/1.0"
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("Pollinations Error:", response.status, errText);
            // Send exact error to frontend for debugging
            return res.status(response.status).send(`Pollinations Error ${response.status}: ${errText.substring(0, 150)}`);
        }

        // Pipe the image directly to the response
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        if (response.body && typeof response.body.pipe === 'function') {
            response.body.pipe(res);
        } else {
            // Fallback for environments where fetch body isn't a stream (rare but possible)
            const arrayBuffer = await response.arrayBuffer();
            res.send(Buffer.from(arrayBuffer));
        }

    } catch (error) {
        console.error("Image Proxy Error:", error.message);
        res.status(500).send(`Server Error: ${error.message}`);
    }
});

// --- MAIN AI ENGINE ---
app.post('/api/chat', async (req, res) => {
    try {
        const correctPassword = (process.env.APP_PASSWORD || process.env.APPPASSWORD || '').trim();
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized: Invalid Password" });

        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid message format." });

        const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTERAPIKEY;
        if (!apiKey) return res.status(500).json({ error: "API Key missing!" });

        // UPDATED SYSTEM PROMPT: Forces Math, Emojis, and Auto-Image Generation formatting
        const myCustomIdentity = `You are Anurag's GPT, a professional, highly intelligent senior web developer AI assistant created by Anurag.
Formatting Rules:
1. EMOJIS: Use relevant emojis at the start of major section headings to be visually engaging.
2. MATH: For all mathematical expressions, equations, and symbols, you MUST use LaTeX formatting enclosed in dollar signs. Use single dollar signs for inline math (e.g., "$x^2$") and double dollar signs for block equations. Do NOT use plain text like "^2".
3. IMAGE GENERATION: If the user asks you to generate, draw, or make an image, OR if you are explaining a visual/complex topic (like Quantum Computing), you MUST generate an image to illustrate it. Use this EXACT markdown format: ![Image](https://gen.pollinations.ai/image/detailed%20visual%20description). Replace spaces in the URL with %20. Do NOT put the image link inside a code block.`;
        
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
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://anurags-gpt.vercel.app", "X-Title": "Anurag's GPT" },
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