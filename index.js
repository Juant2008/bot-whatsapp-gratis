const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// ===== CONFIG =====
const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY;

// ===== IA =====
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ===== DB =====
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

async function db() {
    return await mysql.createConnection(dbConfig);
}

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
let sock = null;
let qrCodeData = "Iniciando...";
let isConnecting = false;

// ===== API DOLAR =====
function obtenerTasa(apiUrl) {
    return new Promise((resolve) => {
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).promedio || null);
                } catch {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

async function construirInstrucciones() {
    const tasa = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/oficial');
    return `Eres ONE4-Bot. Dólar BCV: ${tasa || 'No disponible'}`;
}

// ===== BOT =====
async function startBot() {

    if (isConnecting) return;
    isConnecting = true;

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Ubuntu", "Chrome", "22.04.4"]
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (u) => {

            const { connection, lastDisconnect, qr } = u;

            if (qr) {
                qrcode.toDataURL(qr, (_, url) => {
                    qrCodeData = url;
                });
            }

            if (connection === 'open') {
                console.log("✅ CONECTADO A WHATSAPP");
                qrCodeData = "ONLINE ✅";
                isConnecting = false;
            }

            if (connection === 'close') {

                const code = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output.statusCode
                    : 0;

                console.log("❌ Conexión cerrada. Código:", code);

                isConnecting = false;

                // 🔥 SI SE DESLOGEA → BORRAR SESIÓN
                if (code === DisconnectReason.loggedOut) {
                    console.log("⚠️ Sesión cerrada, eliminando auth_info");
                    require('fs').rmSync('auth_info', { recursive: true, force: true });
                }

                setTimeout(startBot, 8000);
            }
        });

        // ===== MENSAJES =====
        sock.ev.on('messages.upsert', async ({ messages, type }) => {

            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg.message) return;

            const from = msg.key.remoteJid;
            if (from.includes('@g.us')) return;

            const tel = from.split('@')[0];

            // 🔥 HUMANO
            if (msg.key.fromMe) {
                await setModo(tel, 'humano');
                return;
            }

            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!text) return;

            const sesion = await getSesion(tel);

            if (sesion && sesion.modo === 'humano') {
                console.log("⛔ BOT PAUSADO:", tel);
                return;
            }

            try {
                const instrucciones = await construirInstrucciones();

                const chat = model.startChat({
                    history: [{ role: "user", parts: [{ text: instrucciones }] }]
                });

                const r = await chat.sendMessage(text);

                await sock.sendMessage(from, {
                    text: r.response.text()
                });

            } catch (e) {
                console.error("Error IA:", e);

                await sock.sendMessage(from, {
                    text: "⚠️ Sistema en mantenimiento"
                });
            }

        });

    } catch (e) {
        console.error("🔥 Error general:", e);
        isConnecting = false;
        setTimeout(startBot, 10000);
    }
}

// ===== SERVER =====
const server = http.createServer(async (req, res) => {

    const parsed = url.parse(req.url, true);

    if (parsed.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            cobranza.ejecutarEnvioMasivo(sock, JSON.parse(body).facturas);
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
    `);
});

// ===== START =====
server.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 Servidor activo en puerto", PORT);
    startBot();
});