const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');
const mysql = require('mysql2/promise');

// ===== CONFIG =====
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// ===== DB CONTROL HUMANO =====
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

async function setModo(tel, modo) {
    try {
        const conn = await mysql.createConnection(dbConfig);
        await conn.execute(`
            INSERT INTO control_chat (telefono, modo)
            VALUES (?,?)
            ON DUPLICATE KEY UPDATE modo=VALUES(modo)
        `, [tel, modo]);
        await conn.end();
    } catch {}
}

async function esHumano(tel) {
    try {
        const conn = await mysql.createConnection(dbConfig);
        const [r] = await conn.execute(`SELECT modo FROM control_chat WHERE telefono=?`, [tel]);
        await conn.end();
        return r[0] && r[0].modo === 'humano';
    } catch { return false; }
}

// ===== API DÓLAR =====
function obtenerTasa(apiUrl) {
    return new Promise((resolve) => {
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.promedio || null);
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// ===== PROMPT =====
async function construirInstrucciones() {
    const tasaOficial = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/oficial');
    const tasaParalelo = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/paralelo');

    const txtOficial = tasaOficial ? `Bs. ${tasaOficial}` : "No disponible";
    const txtParalelo = tasaParalelo ? `Bs. ${tasaParalelo}` : "No disponible";
    const fecha = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    let contenido = fs.readFileSync('./instrucciones.txt', 'utf8');
    contenido = contenido.replace('${fecha}', fecha);
    contenido = contenido.replace('${txtOficial}', txtOficial);
    contenido = contenido.replace('${txtParalelo}', txtParalelo);

    return contenido;
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
            console.log("Conectado");
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

        // ❌ IGNORAR GRUPOS
        if (from.includes('@g.us')) return;

        const telefono = from.split('@')[0];

        // 🔴 SI ES TUYO → ACTIVAR HUMANO
        if (msg.key.fromMe) {
            await setModo(telefono, 'humano');
            return;
        }

        // 🔴 SI ESTÁ EN HUMANO → NO RESPONDE
        if (await esHumano(telefono)) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        try {
            const instrucciones = await construirInstrucciones();

            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: instrucciones }] },
                    { role: "model", parts: [{ text: "Entendido." }] }
                ]
            });

            const result = await chat.sendMessage(text);
            const response = result.response.text();

            await sock.sendMessage(from, { text: response });

        } catch (e) {
            await sock.sendMessage(from, {
                text: "⚠️ Sistema en mantenimiento. Escriba *menu*."
            });
        }
    });
}

// ===== SERVER =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/cobranza') {
        const d = await cobranza.obtenerListaDeudores({});
        res.end(`<h2>Cobranza (${d.length})</h2>`);
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <h2>ONE4CARS BOT</h2>
        ${
            qrCodeData.startsWith('data')
            ? `<img src="${qrCodeData}" width="250">`
            : `<h3>${qrCodeData || "Iniciando..."}</h3>`
        }
    `);
});

// ✅ SOLO UNA VEZ
server.listen(port, '0.0.0.0', () => {
    startBot();
});