const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// ===== CONFIG =====
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
});

const PORT = process.env.PORT || 10000;

// ===== DB (MISMA QUE COBRANZA) =====
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

async function db() {
    return await mysql.createConnection(dbConfig);
}

// ===== CONTROL HUMANO =====
async function getSesion(tel) {
    const conn = await db();
    const [r] = await conn.execute("SELECT * FROM control_chat WHERE telefono=?", [tel]);
    await conn.end();
    return r[0] || null;
}

async function setModo(tel, modo) {
    const conn = await db();
    await conn.execute(`
        INSERT INTO control_chat (telefono, modo)
        VALUES (?,?)
        ON DUPLICATE KEY UPDATE modo=VALUES(modo)
    `, [tel, modo]);
    await conn.end();
}

// ===== VARIABLES =====
let qrCodeData = "Iniciando...";
let socketBot = null;

// ===== API DOLAR =====
function obtenerTasa(apiUrl) {
    return new Promise((resolve) => {
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.promedio || null);
                } catch {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

// ===== PROMPT IA =====
async function construirInstrucciones() {
    const tasaOficial = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/oficial');
    const tasaParalelo = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/paralelo');

    return `Eres ONE4-Bot experto en autopartes...`; // (puedes dejar tu prompt completo aquí igual)
}

// ===== BOT =====
async function startBot() {

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr) qrcode.toDataURL(qr, (_, url) => qrCodeData = url);

        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("CONECTADO");
        }

        if (connection === 'close') {
            const shouldReconnect =
                (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {

        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return;

        const tel = from.split('@')[0];

        // 🔥 SI ES TUYO → ACTIVAR MODO HUMANO
        if (msg.key.fromMe) {
            await setModo(tel, 'humano');
            return;
        }

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        // 🔥 VALIDAR MODO
        const sesion = await getSesion(tel);

        if (sesion && sesion.modo === 'humano') {
            console.log("PAUSADO (modo humano):", tel);
            return;
        }

        try {
            if (!apiKey) throw new Error("Sin API KEY");

            const instrucciones = await construirInstrucciones();

            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: instrucciones }] }
                ]
            });

            const r = await chat.sendMessage(text);

            await sock.sendMessage(from, {
                text: r.response.text()
            });

        } catch (e) {
            console.error(e);

            await sock.sendMessage(from, {
                text: "⚠️ Sistema en mantenimiento, use el menú."
            });
        }
    });
}

// ===== SERVER =====
const server = http.createServer(async (req, res) => {

    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/cobranza') {

        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsed.query);

            res.end("Panel OK"); // puedes mantener tu HTML original aquí

        } catch (e) {
            res.end("Error: " + e.message);
        }

        return;
    }

    if (parsed.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);

        req.on('end', () => {
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(body).facturas);
            res.end("OK");
        });

        return;
    }

    res.end(`
        <h2>ONE4CARS BOT</h2>
        ${qrCodeData.startsWith('data') 
            ? `<img src="${qrCodeData}" width="250">`
            : `<h3>${qrCodeData}</h3>`
        }
        <br><a href="/cobranza">Cobranza</a>
    `);
});

// ===== START =====
server.listen(PORT, () => {
    console.log("Servidor en puerto", PORT);
    startBot();
});