// index.js - ONE4CARS BOT COMPLETO
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const cobranza = require('./cobranza');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==== CONFIGURACIÓN ====
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// ==== CONTROL DE MENSAJES DUPLICADOS ====
const mensajesProcesados = new Set();

// ==== KEEP ALIVE LOG ====
setInterval(() => console.log("Bot activo..."), 300000);

// ==== FUNCIONES AUXILIARES ====
async function obtenerTasa(apiUrl) {
    return new Promise(resolve => {
        https.get(apiUrl, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { const json = JSON.parse(data); resolve(json.promedio || null); }
                catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

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

// ==== INICIO DEL BOT ====
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

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log("Estado conexión:", connection);

        if (qr) {
            console.log("QR RECIBIDO ✅");
            qrcode.toDataURL(qr, (err, url) => {
                if (err) console.log("Error QR:", err);
                else qrCodeData = url;
            });
        }

        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("✅ BOT CONECTADO");
        }

        if (connection === 'close') {
            console.log("❌ CONEXIÓN CERRADA");
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔁 REINTENTANDO CONEXIÓN...");
                setTimeout(startBot, 5000);
            }
        }
    });

    // ==== HANDLER DE MENSAJES ====
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

        console.log("Mensaje recibido:", text);

        try {
            if (!apiKey) throw new Error("Sin API KEY");

            const instrucciones = await construirInstrucciones();

            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: instrucciones }] },
                    { role: "model", parts: [{ text: "Entendido. Soy ONE4-Bot, listo para asistir." }] }
                ]
            });

            const result = await chat.sendMessage(text);
            let response = result.response.text();

            if (!response || response.length < 2) {
                response = "🚗 *ONE4-Bot:* Estoy procesando su solicitud. Un asesor le responderá en breve.";
            }

            await sock.sendMessage(from, { text: response });
        } catch (e) {
            console.error("Error IA:", e.message);
            const fallback = `🚗 *ONE4-Bot:*

Disculpe, estamos actualizando el sistema 🔧

1️⃣ Pagos: https://www.one4cars.com/medios_de_pago.php/  
2️⃣ Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/  
3️⃣ Lista de precios: https://www.one4cars.com/lista_de_precios.php/

Un asesor humano le atenderá pronto.`;
            await sock.sendMessage(from, { text: fallback });
        }
    });
}

// ==== SERVIDOR WEB ==== 
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                <nav>
                    <a href="/" class="text-white me-3 small">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm fw-bold">COBRANZA</a>
                </nav>
            </div>
        </header>
    `;

    // ==== COBRANZA ====
    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <html>
                <head>
                    <title>Cobranza - ONE4CARS</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container bg-white shadow p-4 rounded-3">
                        <h3>Gestión de Cobranza</h3>
                        <p>Facturas: ${d.length}</p>
                        <table class="table table-sm text-center">
                            <thead>
                                <tr>
                                    <th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Saldo Bs</th><th>Días</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${d.map(i => `
                                    <tr>
                                        <td>${i.nombres}</td>
                                        <td>${i.nro_factura}</td>
                                        <td>${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                        <td>${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                        <td>${i.dias_transcurridos}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </body>
                </html>
            `);
            res.end();
        } catch (e) { res.end(`Error SQL: ${e.message}`); }
        return;
    }

    // ==== ENVIO COBRANZA MASIVA ====
    if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(body).facturas);
            res.end("OK");
        });
        return;
    }

    // ==== STATUS GENERAL ====
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <html>
        <body class="text-center">
            ${header}
            <h2>ONE4CARS BOT</h2>
            ${qrCodeData.startsWith('data') 
                ? `<img src="${qrCodeData}" width="250"/>`
                : `<h3>${qrCodeData || "Iniciando..."}</h3>`}
        </body>
        </html>
    `);
});

// ==== LISTEN ====
server.listen(port, '0.0.0.0', () => startBot());