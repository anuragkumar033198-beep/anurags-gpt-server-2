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

// --- DYNAMIC PWA GENERATORS (Fixes Vercel Static Block) ---
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
        const CACHE_NAME = 'anurags-gpt-v1';
        self.addEventListener('install', event => {
            self.skipWaiting();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add('/')));
        });
        self.addEventListener('activate', event => {
            event.waitUntil(clients.claim());
        });
        self.addEventListener('fetch', event => {
            event.respondWith(fetch(event.request).catch(() => caches.match('/')));
        });
    `);
});

app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json({
      "name": "Anurag's GPT",
      "short_name": "AnuragGPT",
      "description": "Anurag's Custom AI Backend",
      "start_url": "/",
      "display": "standalone",
      "background_color": "#0d1117",
      "theme_color": "#0d1117",
      "orientation": "portrait",
      "icons": [
        { "src": "/icon.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" },
        { "src": "/icon.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" }
      ]
    });
});

// --- THE BULLETPROOF HTML ROUTER ---
app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    
    if (fs.existsSync(publicPath)) {
        return res.sendFile(publicPath);
    } else if (fs.existsSync(rootPath)) {
        return res.sendFile(rootPath);
    } else {
        return res.send(`
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px; color: #333; background: white; padding: 20px;">
                <h1>✅ The Server is Online!</h1>
                <p style="color: red;">❌ But <b>index.html</b> is completely missing from the server.</p>
            </div>
        `);
    }
});

// A SECRET DEV ROUTE
app.get('/ping', (req, res) => {
    res.status(200).send("<h2>PONG! The backend is 100% alive.</h2>");
});

// --- SECURITY SYSTEM ---
const failedAttempts = new Map(); 
const bannedIPs = new Set();      
const MAX_ATTEMPTS = 5;

const getIP = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || "Unknown IP";

app.use('/api', (req, res, next) => {
    if (req.path === '/unban') return next(); 
    const ip = getIP(req);
    if (bannedIPs.has(ip)) {
        return res.status(403).json({ error: "BANNED: Your IP has been blocked." });
    }
    next();
});

// 1. Password Verification
app.post('/api/verify', async (req, res) => {
    const ip = getIP(req);
    const correctPassword = process.env.APP_PASSWORD || process.env.APPPASSWORD;
    const userPassword = req.headers['x-app-password'];
    
    if (correctPassword && userPassword !== correctPassword) {
        let attempts = (failedAttempts.get(ip) || 0) + 1;
        failedAttempts.set(ip, attempts);
        
        if (attempts >= MAX_ATTEMPTS) {
            bannedIPs.add(ip); 
            return res.status(403).json({ error: "BANNED" });
        }
        return res.status(401).json({ error: "Incorrect Password", attemptsLeft: MAX_ATTEMPTS - attempts });
    }
    
    failedAttempts.delete(ip);
    res.json({ success: true });
});

// 2. Secret Dev Unban Route
app.get('/api/unban', (req, res) => {
    const targetIp = req.query.ip;
    const providedPwd = req.query.pwd;
    const correctPassword = process.env.APP_PASSWORD || process.env.APPPASSWORD;

    if (!correctPassword || providedPwd !== correctPassword) {
        return res.status(401).send("<h1 style='color:red;'>Unauthorized</h1>");
    }
    if (targetIp) {
        bannedIPs.delete(targetIp);
        failedAttempts.delete(targetIp);
        return res.send(`<h1 style='color:green;'>Unbanned!</h1><p>IP <b>${targetIp}</b> has been removed.</p>`);
    }
    res.send("<h1>Error</h1><p>No IP provided.</p>");
});

// 3. The Main AI Chat Engine
app.post('/api/chat', async (req, res) => {
    try {
        const correctPassword = process.env.APP_PASSWORD || process.env.APPPASSWORD;
        const userPassword = req.headers['x-app-password'];

        if (correctPassword && userPassword !== correctPassword) {
            return res.status(401).json({ error: "Unauthorized: Invalid Password" });
        }

        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid message format." });

        const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTERAPIKEY;
        if (!apiKey) return res.status(500).json({ error: "API Key missing!" });

        const myCustomIdentity = "You are Anurag's GPT, a highly intelligent senior web developer AI assistant created by Anurag. Never refer to yourself as Gemini, OpenAI, ChatGPT, LLaMA, or any other corporate entity.";
        
        if (messages.length > 0) {
            if (typeof messages[0].content === 'string' && !messages[0].content.includes("[STRICT SYSTEM INSTRUCTIONS:")) {
                messages[0].content = `[STRICT SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUser Message: ${messages[0].content}`;
            } else if (Array.isArray(messages[0].content)) {
                let textObj = messages[0].content.find(c => c.type === 'text');
                if (textObj && !textObj.text.includes("[STRICT SYSTEM INSTRUCTIONS:")) {
                    textObj.text = `[STRICT SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUser Message: ${textObj.text}`;
                }
            }
        }

        const autoModels = ["openrouter/auto", "openrouter/free"];
        let response = null;
        let errorLogs = [];

        for (const currentModel of autoModels) {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://anurags-gpt.vercel.app", 
                    "X-Title": "Anurag's GPT"
                },
                body: JSON.stringify({ model: currentModel, messages: messages, stream: true })
            });

            if (response.ok) break;
            else {
                let errText = `HTTP ${response.status}`;
                try { errText = (await response.json()).error?.message || errText; } catch(e) {}
                errorLogs.push(`${currentModel}: ${errText}`);
            }
        }

        if (!response || !response.ok) {
            return res.status(response ? response.status : 500).json({ error: "Auto-Routing Failed.\n\nDiagnostics:\n" + errorLogs.join("\n") });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); 
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
        console.error("Chat API Error:", error.message);
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error." });
        else res.end();
    }
});

app.use((err, req, res, next) => {
    console.error("Unhandled Server Error:", err.stack);
    res.status(500).send('Something broke!');
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Anurag's GPT Backend is running!`);
});

module.exports = app;
