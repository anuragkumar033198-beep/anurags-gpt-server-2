const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();

// --- GLOBAL MIDDLEWARE ---
app.use(cors()); 
app.use(express.json({ limit: '50mb' })); 

// VERY IMPORTANT: { index: false } prevents the server from secretly serving an empty index.html
app.use(express.static(path.join(__dirname, 'public'), { index: false })); 
app.use(express.static(__dirname, { index: false })); 

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
                <p>Please check your files.</p>
            </div>
        `);
    }
});

// A SECRET DEV ROUTE
app.get('/ping', (req, res) => {
    res.status(200).send("<h2>PONG! The backend is 100% alive and routing correctly.</h2>");
});

// --- SECURITY SYSTEM (IP BANNING & RATE LIMITING) ---
const failedAttempts = new Map(); 
const bannedIPs = new Set();      
const MAX_ATTEMPTS = 5;

const getIP = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || "Unknown IP";

app.use('/api', (req, res, next) => {
    if (req.path === '/unban') return next(); 
    const ip = getIP(req);
    if (bannedIPs.has(ip)) {
        return res.status(403).json({ error: "BANNED: Your IP has been blocked due to suspicious activity." });
    }
    next();
});

// --- API ROUTES ---

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
            const webhookUrl = process.env.DISCORD_WEBHOOK_URL || process.env.DISCORDWEBHOOKURL;
            if (webhookUrl) {
                const unbanLink = `https://${req.get('host')}/api/unban?ip=${ip}&pwd=YOUR_APP_PASSWORD_HERE`;
                fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `🚨 **SECURITY ALERT** 🚨\nAn intruder has been permanently **IP BANNED**.\n**IP:** \`${ip}\`\n\n🛠️ **Unban Link:**\n${unbanLink}`
                    })
                }).catch(() => {});
            }
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
        return res.status(401).send("<h1 style='color:red;'>Unauthorized</h1><p>Incorrect developer password.</p>");
    }

    if (targetIp) {
        bannedIPs.delete(targetIp);
        failedAttempts.delete(targetIp);
        return res.send(`<h1 style='color:green;'>Unbanned!</h1><p>IP <b>${targetIp}</b> has been successfully removed from the ban list.</p>`);
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
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: "Invalid message format." });
        }

        const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTERAPIKEY;
        if (!apiKey) {
            return res.status(500).json({ error: "Server Configuration Error: OpenRouter API Key is missing!" });
        }

        const myCustomIdentity = "You are Anurag's GPT, a highly intelligent senior web developer AI assistant created by Anurag. If someone asks 'Who are you?', proudly state that you are Anurag's GPT. If someone asks 'Who is he?' or 'Who is Anurag?', state that Anurag is your creator and a brilliant developer. Never refer to yourself as Gemini, OpenAI, ChatGPT, LLaMA, or any other corporate entity.";
        
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

        // --- THE DYNAMIC AUTO-ROUTER LOOP ---
        const autoModels = [
            "openrouter/auto", // Best available model
            "openrouter/free"  // Explicitly cycles free endpoints only
        ];

        let response = null;
        let errorLogs = [];

        for (const currentModel of autoModels) {
            console.log(`Routing through: ${currentModel}...`);
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://anurags-gpt.vercel.app", 
                    "X-Title": "Anurag's GPT"
                },
                body: JSON.stringify({
                    model: currentModel,
                    messages: messages,
                    stream: true 
                })
            });

            if (response.ok) {
                console.log(`Success! Stream established via: ${currentModel}`);
                break; 
            } else {
                let errText = `HTTP ${response.status}`;
                try {
                    const errData = await response.json();
                    errText = errData.error?.message || errText;
                } catch(e) {}
                errorLogs.push(`${currentModel}: ${errText}`);
            }
        }

        if (!response || !response.ok) {
            let finalErrorMsg = "OpenRouter Auto-Routing Failed.\n\nDiagnostics:\n" + errorLogs.map(log => `• ${log}`).join("\n");
            return res.status(response ? response.status : 500).json({ error: finalErrorMsg });
        }

        // --- RAW BYTE-STREAM BYPASS (Forces Live-Streaming) ---
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); 
        res.flushHeaders(); 
        
        // This physically rips the data out of OpenRouter's payload and flushes it immediately
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
            // Force Express/Node to push the data out to the network immediately
            if (typeof res.flush === 'function') {
                res.flush(); 
            }
        }
        res.end();

    } catch (error) {
        console.error("Chat API Error:", error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal Server Error occurred during generation." });
        } else {
            res.end();
        }
    }
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error("Unhandled Server Error:", err.stack);
    res.status(500).send('Something broke on the server!');
});

// --- SERVER INITIALIZATION ---
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Anurag's GPT Backend is running smoothly on port ${port}!`);
});

module.exports = app;
