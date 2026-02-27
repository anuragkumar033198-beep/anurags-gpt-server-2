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

// --- UNIVERSAL KEY SANITIZER (This safely handles underscores and spaces!) ---
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

// --- RESTORED WORKING IMAGE PROXY (UNTOUCHED) ---
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

// --- HUGGING FACE PROXY (PHOTO EDITING) - FIXED JSON & HTML STRIPPER ---
app.post('/api/edit-image', async (req, res) => {
    try {
        let rawAppKey = process.env.APP_PASSWORD || process.env.APPPASSWORD || '';
        const correctPassword = rawAppKey.replace(/[\r\n\s]+/g, '');
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized" });
        
        const { imageBase64, prompt } = req.body;
        if (!imageBase64 || !prompt) return res.status(400).json({ error: "Data missing." });
        
        let rawHFKey = process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACEAPIKEY || '';
        let cleanKey = rawHFKey.replace(/[\r\n\s]+/g, ''); 
        if (cleanKey.toLowerCase().startsWith('bearer')) cleanKey = cleanKey.substring(6);

        if (!cleanKey) return res.status(500).json({ error: "Hugging Face API Key missing in Variables!" });
        
        // Strip the standard data URI prefix so Hugging Face gets pure binary data
        const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        
        // FIXED: Using standard JSON. 410 Error happened because HF disabled form-data.
        // We use RunwayML as it natively supports Image-to-Image via JSON payloads.
        const modelsToTry = [
            "runwayml/stable-diffusion-v1-5",
            "SG161222/Realistic_Vision_V5.1_noVAE",
            "stabilityai/stable-diffusion-2-1"
        ];

        let response = null;
        let lastError = "";
        let success = false;

        for (const model of modelsToTry) {
            response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${cleanKey}`, 
                    "Content-Type": "application/json",
                    "X-Wait-For-Model": "true" // This forces HuggingFace to wait and wake up the AI instead of crashing!
                },
                body: JSON.stringify({ 
                    inputs: base64Data, 
                    parameters: { prompt: prompt, strength: 0.65 }
                })
            });
            
            if (response.ok) {
                success = true;
                break;
            }
            
            lastError = await response.text();
        }
        
        // FIXED: Strips HTML out of the error message so the frontend doesn't draw an empty code box!
        if (!success || !response || !response.ok) { 
            let cleanErr = lastError.replace(/<[^>]*>?/gm, '').trim().substring(0, 150);
            try { 
                const parsed = JSON.parse(lastError);
                cleanErr = parsed.error || parsed.message || cleanErr;
            } catch(e) {}
            
            if (cleanErr.includes('410') || response.status === 410) {
                throw new Error("Hugging Face disabled this free endpoint (410 Gone). Please try a different prompt.");
            }
            throw new Error(`HF Models Failed (${response ? response.status : 'N/A'}): ${cleanErr}`); 
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const outputBase64 = Buffer.from(arrayBuffer).toString('base64');
        
        res.json({ success: true, image: `data:image/jpeg;base64,${outputBase64}` });
    } catch (error) { 
        console.error("Edit Error:", error.message); 
        res.status(500).json({ error: error.message }); 
    }
});

// --- MAIN CHAT ENGINE (UNTOUCHED) ---
app.post('/api/chat', async (req, res) => {
    try {
        let rawAppKey = process.env.APP_PASSWORD || process.env.APPPASSWORD || '';
        const correctPassword = rawAppKey.replace(/[\r\n\s]+/g, '');
        const userPassword = (req.headers['x-app-password'] || '').trim();
        if (correctPassword && userPassword !== correctPassword) return res.status(401).json({ error: "Unauthorized: Invalid Password" });

        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Invalid message format." });

        let rawOpenRouter = process.env.OPENROUTER_API_KEY || process.env.OPENROUTERAPIKEY || '';
        let apiKey = rawOpenRouter.replace(/[\r\n\s]+/g, ''); 
        if (apiKey.toLowerCase().startsWith('bearer')) apiKey = apiKey.substring(6);

        if (!apiKey) return res.status(500).json({ error: "API Key missing!" });

        const myCustomIdentity = `You are Anurag's GPT, a highly intelligent senior AI assistant created by Anurag.
Formatting Rules:
1. MATH NOTATION (CRITICAL): You MUST wrap EVERY mathematical equation, variable, or symbol in LaTeX dollar signs. Example inline: "$x^2$", "$E=mc^2$". Block equations: "$$ y = mx + c $$". NEVER use raw text for math like "^2" or "x^2" without the "$" wrappers.
2. AUTOMATIC IMAGES: Whenever explaining a topic, you MUST ALWAYS generate a relevant illustrative image at the VERY TOP of your response. Use EXACTLY this markdown format: ![Image](https://gen.pollinations.ai/image/highly%20detailed%20visual%20description). Do NOT put the image link inside a code block.
3. EMOJIS: Use emojis at the start of major section headings.
4. YOUR IDENTITY & LOGO (CRITICAL RULE): If the user uploads an image of a blue circular icon with a white lightning bolt in the middle, DO NOT say it is Discord or a thunderbolt. You MUST recognize it and proudly declare that it is YOUR logo: The "Anurag's GPT" logo.`;
        
        if (messages.length > 0) {
            const lastMessageIndex = messages.length - 1;
            if (messages[lastMessageIndex].role === 'user') {
                 if (typeof messages[lastMessageIndex].content === 'string') {
                    messages[lastMessageIndex].content = `[STRICT SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUser Message: ${messages[lastMessageIndex].content}`;
                 } else if (Array.isArray(messages[lastMessageIndex].content)) {
                     let textObj = messages[lastMessageIndex].content.find(c => c.type === 'text');
                     if (textObj) textObj.text = `[STRICT SYSTEM INSTRUCTIONS: ${myCustomIdentity}]\n\nUser Message: ${textObj.text}`;
                 }
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