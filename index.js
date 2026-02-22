const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); 

// Tells Replit to look inside your 'public' folder for files (CSS, images, etc.)
app.use(express.static(path.join(__dirname, 'public'))); 

// Explicitly serve index.html from the public folder when someone visits your link
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SECURITY SYSTEM (SERVER-SIDE) ---
const failedAttempts = new Map(); // Tracks failed attempts by IP
const bannedIPs = new Set();      // The permanent ban list
const MAX_ATTEMPTS = 5;

// Helper function to grab the user's real IP address
const getIP = (req) => req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || "Unknown IP";

// Middleware: Intercepts EVERY API request and blocks banned IPs instantly
app.use('/api', (req, res, next) => {
    if (req.path === '/unban') return next(); // Let the unban route through!
    const ip = getIP(req);
    if (bannedIPs.has(ip)) {
        return res.status(403).json({ error: "BANNED" });
    }
    next();
});

// --- ROUTES ---

// 1. Password Verification Route
app.post('/api/verify', async (req, res) => {
    const ip = getIP(req);
    const correctPassword = process.env.APP_PASSWORD;
    const userPassword = req.headers['x-app-password'];
    
    if (correctPassword && userPassword !== correctPassword) {
        // Increment their strike count
        let attempts = (failedAttempts.get(ip) || 0) + 1;
        failedAttempts.set(ip, attempts);
        
        if (attempts >= MAX_ATTEMPTS) {
            bannedIPs.add(ip); // DROP THE HAMMER!
            
            // Fire Discord Alert with the Unban Link
            const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
            if (webhookUrl) {
                const unbanLink = `https://${req.get('host')}/api/unban?ip=${ip}&pwd=YOUR_APP_PASSWORD_HERE`;
                try {
                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: `🚨 **SECURITY ALERT: Anurag's GPT** 🚨\nAn intruder has been permanently **IP BANNED** after 5 failed attempts.\n**Intruder IP:** \`${ip}\`\n\n🛠️ **Developer Override:**\nTo unban this user, replace "YOUR_APP_PASSWORD_HERE" with your real password and click this link:\n${unbanLink}`
                        })
                    });
                } catch(e) { console.error("Webhook failed", e); }
            }
            return res.status(403).json({ error: "BANNED" });
        }
        
        // Return how many tries they have left
        return res.status(401).json({ error: "Incorrect Password", attemptsLeft: MAX_ATTEMPTS - attempts });
    }
    
    // Success! Clear their record.
    failedAttempts.delete(ip);
    res.json({ success: true });
});

// 2. The Secret Developer Unban Route
app.get('/api/unban', (req, res) => {
    const targetIp = req.query.ip;
    const providedPwd = req.query.pwd;
    const correctPassword = process.env.APP_PASSWORD;

    // Check if the developer typed the password correctly in the URL
    if (!correctPassword || providedPwd !== correctPassword) {
        return res.status(401).send("<h1 style='color:red;'>Unauthorized</h1><p>Incorrect developer password.</p>");
    }

    if (targetIp) {
        bannedIPs.delete(targetIp);
        failedAttempts.delete(targetIp);
        return res.send(`<h1 style='color:green;'>Unbanned!</h1><p>The IP <b>${targetIp}</b> has been successfully removed from the ban list. They can now access the app.</p>`);
    }
    
    res.send("<h1>Error</h1><p>No IP provided in the link.</p>");
});

// 3. The Main Chat Route
app.post('/api/chat', async (req, res) => {
    try {
        const correctPassword = process.env.APP_PASSWORD;
        const userPassword = req.headers['x-app-password'];

        if (correctPassword && userPassword !== correctPassword) {
            return res.status(401).json({ error: "Unauthorized: Incorrect Password" });
        }

        const { messages } = req.body;
        const apiKey = process.env.OPENROUTER_API_KEY;
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

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://anurags-gpt.replit.app", 
                "X-Title": "Anurag's GPT"
            },
            body: JSON.stringify({
                models: [
                    "google/gemma-3-27b-it:free",
                    "meta-llama/llama-3.2-11b-vision-instruct:free",
                    "qwen/qwen2.5-vl-32b-instruct:free"
                ],
                messages: messages,
                stream: true 
            })
        });

        if (!response.ok) {
            let customErrorMessage = `API Error ${response.status}`;
            try {
                const errorData = await response.json();
                const apiMsg = errorData.error?.message || "";
                if (response.status === 429) {
                    customErrorMessage = `**Rate Limit Exceeded (429):** You have hit the daily cap for free models. OpenRouter allows 50 free messages per day for completely free accounts. Please wait for the daily reset, or add a small credit balance (even $5) to your OpenRouter account to unlock 1,000 free messages per day! \n\n*API Detail: ${apiMsg}*`;
                } else if (response.status === 401) {
                    customErrorMessage = `**Unauthorized (401):** Your OpenRouter API key is invalid. Please check your Replit Secrets.`;
                } else if (response.status === 402) {
                    customErrorMessage = `**Insufficient Funds (402):** Your OpenRouter account is out of credits.`;
                } else if (response.status === 502 || response.status === 503) {
                    customErrorMessage = `**Provider Down (${response.status}):** The AI models are currently congested or offline. Please try again in a moment.`;
                } else {
                    customErrorMessage = `**Error ${response.status}:** ${apiMsg || "Unknown error occurred while contacting the AI."}`;
                }
            } catch (parseError) { customErrorMessage = `**Error ${response.status}:** Unable to connect to OpenRouter.`; }
            return res.status(response.status).json({ error: customErrorMessage });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders(); 
        for await (const chunk of response.body) { res.write(chunk); }
        res.end();

    } catch (error) {
        console.error("Server Error:", error);
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
        else res.end();
    }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Anurag's GPT Backend is running on port ${port}!`);
});
