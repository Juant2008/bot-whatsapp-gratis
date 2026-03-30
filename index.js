const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Módulos
const cobranza = require('./cobranza');
const marketing = require('./marketing');

const PORT = process.env.PORT || 10000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const dbConfig = { host: 'one4cars.com', user: 'juant200_one4car', password: 'Notieneclave1*', database: 'juant200_venezon' };

let qrCodeData = "Iniciando...";
let socketBot = null;
let dolarInfo = { bcv: 'Cargando...', paralelo: 'Cargando...' };

async function db() { return await mysql.createConnection(dbConfig); }

// --- FUNCIONES DE CONTROL ---
async function setModo(tel, modo) {
    const conn = await db();
    await conn.execute("INSERT INTO control_chat (telefono, modo) VALUES (?,?) ON DUPLICATE KEY UPDATE modo=VALUES(modo)", [tel, modo]);
    await conn.end();
}

async function getSesion(tel) {
    const conn = await db();
    const [r] = await conn.execute("SELECT * FROM control_chat WHERE telefono=?", [tel]);
    await conn.end();
    return r[0] || null;
}

async function obtenerDolar() {
    try {
        const res = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        dolarInfo.bcv = res.data.monitors.bcv.price;
        dolarInfo.paralelo = res.data.monitors.enparalelovzla.price;
    } catch (e) { console.error("Error Dólar:", e.message); }
}

// --- BOT WHATSAPP ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    socketBot = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (_, url) => qrCodeData = url);
        if (connection === 'open') { qrCodeData = "ONLINE ✅"; console.log("WhatsApp Conectado"); }
        if (connection === 'close') {
            if ((lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
        }
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.remoteJid === 'status@broadcast') return;

        const from = m.key.remoteJid;
        if (from.includes('@g.us')) return; // IGNORAR GRUPOS

        const tel = from.split('@')[0];

        // CONTROL HUMANO: Si yo escribo desde el cel, el bot se apaga para ese cliente
        if (m.key.fromMe) {
            await setModo(tel, 'humano');
            return;
        }

        const sesion = await getSesion(tel);
        if (sesion && sesion.modo === 'humano') return;

        const text = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase();
        
        if (text.includes("dolar") || text.includes("tasa")) {
            await obtenerDolar();
            return socketBot.sendMessage(from, { text: `📊 *Tasas de Cambio:*\n\nBCV: ${dolarInfo.bcv} Bs.\nParalelo: ${dolarInfo.paralelo} Bs.` });
        }

        // IA GEMINI
        try {
            const prompt = fs.readFileSync('./instrucciones.txt', 'utf8');
            const result = await model.generateContent(`${prompt}\n\nUsuario dice: ${text}`);
            await socketBot.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.error("Error IA:", e); }
    });
}

// --- SERVIDOR HTTP (PANEL) ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `<nav class="navbar navbar-dark bg-dark mb-4"><div class="container"><a class="navbar-brand" href="/">ONE4CARS ADMIN</a></div></nav>`;

    if (parsedUrl.pathname === '/cobranza') {
        const v = await cobranza.obtenerVendedores();
        const z = await cobranza.obtenerZonas();
        const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(await cobranza.generarHTML(v, z, d, header, parsedUrl.query));

    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', () => { 
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(body).facturas); 
            res.end("OK"); 
        });

    } else if (parsedUrl.pathname === '/enviar-marketing' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (data.tipo === 'precios') await marketing.enviarListaPrecios(socketBot, data.clientes);
            if (data.tipo === 'promo') await marketing.enviarPromoWeb(socketBot, data.clientes);
            res.end("OK");
        });

    } else {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(`<html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
        <body class="bg-light text-center">${header}<div class="container py-5">
        <div class="card shadow p-4 mx-auto" style="max-width:450px;">
        <h4>Status de Conexión</h4><div class="mb-4">
        ${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width:250px;">` : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData}</div>`}
        </div><p class="text-primary fw-bold">Dólar BCV: ${dolarInfo.bcv} | Paralelo: ${dolarInfo.paralelo}</p><hr>
        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2 mb-2">IR AL PANEL DE COBRANZA</a>
        </div></div></body></html>`);
    }
});

// EVITAR ERROR EADDRINUSE
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log('Puerto ocupado, reintentando...');
        setTimeout(() => { server.close(); server.listen(PORT); }, 1000);
    }
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    startBot();
    obtenerDolar();
    setInterval(obtenerDolar, 3600000); // Cada hora
});
