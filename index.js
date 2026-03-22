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

// ===== CONFIG =====
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000
    }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// ===== CONTROL =====
const mensajesProcesados = new Set();

// ===== KEEP ALIVE =====
setInterval(() => console.log("Bot activo..."), 300000);

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

// ===== INSTRUCCIONES DINAMICAS =====
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

        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);

        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("BOT CONECTADO ✅");
        }

        if (connection === 'close') {
            const shouldReconnect =
                (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log("Reconectando...");
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;

        // 🚫 IGNORAR GRUPOS
        if (from.includes('@g.us')) return;

        // 🔒 ANTIDUPLICADOS
        const id = msg.key.id;
        if (mensajesProcesados.has(id)) return;
        mensajesProcesados.add(id);

        const text = (
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ""
        ).trim();

        if (!text) return;

        try {
            if (!apiKey) throw new Error("Sin API KEY");

            const instrucciones = await construirInstrucciones();

            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: instrucciones }] },
                    { role: "model", parts: [{ text: "Entendido." }] }
                ]
            });

            const result = await chat.sendMessage(text);
            let response = result.response.text();

            if (!response || response.length < 2) {
                response = "🚗 *ONE4-Bot:* Procesando su solicitud...";
            }

            await sock.sendMessage(from, { text: response });

        } catch (e) {
            console.error("Error IA:", e.message);

            const fallback = `🚗 *ONE4-Bot:*

Disculpe, estamos actualizando el sistema 🔧

1️⃣ Pagos  
https://www.one4cars.com/medios_de_pago.php/

2️⃣ Estado de cuenta  
https://www.one4cars.com/estado_de_cuenta.php/

3️⃣ Precios  
https://www.one4cars.com/lista_de_precios.php/

Un asesor le atenderá pronto.`;

            await sock.sendMessage(from, { text: fallback });
        }
    });
}

// ===== SERVIDOR WEB =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);

        req.on('end', () => {
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(body).facturas);
            res.end("OK");
        });

        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    res.end(`
        <html>
        <body style="text-align:center;font-family:sans-serif">
            <h2>ONE4CARS BOT</h2>
            ${
                qrCodeData.startsWith('data')
                ? `<img src="${qrCodeData}" width="250"/>`
                : `<h1>${qrCodeData || "Iniciando..."}</h1>`
            }
        </body>
        </html>
    `);
});

server.listen(port, '0.0.0.0', () => {
    startBot();
});