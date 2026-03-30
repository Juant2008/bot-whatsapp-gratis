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

// Módulos internos
const cobranza = require('./cobranza');
const marketing = require('./marketing');

const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Configuración DB
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let qrCodeData = "Iniciando...";
let socketBot = null;
let dolarInfo = { bcv: '0', paralelo: '0' };

// ===== FUNCIONES DE AYUDA =====
async function db() { return await mysql.createConnection(dbConfig); }

async function obtenerDolar() {
    try {
        // Usando una API pública de ejemplo para Venezuela
        const res = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        dolarInfo.bcv = res.data.monitors.bcv.price;
        dolarInfo.paralelo = res.data.monitors.enparalelovzla.price;
    } catch (e) { console.log("Error obteniendo dólar", e.message); }
}

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

// ===== LÓGICA DEL BOT =====
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
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const from = msg.key.remoteJid;
        
        // 1. IGNORAR GRUPOS
        if (from.endsWith('@g.us')) return;

        const tel = from.split('@')[0];

        // 2. DETECTAR CONTROL HUMANO (Si yo envío un mensaje desde el cel, el bot se calla)
        if (msg.key.fromMe) {
            await setModo(tel, 'humano');
            return;
        }

        // 3. VERIFICAR SI EL BOT DEBE RESPONDER
        const sesion = await getSesion(tel);
        if (sesion && sesion.modo === 'humano') return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        if (!text) return;

        // Comandos rápidos
        if (text === 'dolar' || text === 'precio') {
            await obtenerDolar();
            return await socketBot.sendMessage(from, { text: `💵 *Tasas del día:*\n\nBCV: ${dolarInfo.bcv} Bs.\nEnParalelo: ${dolarInfo.paralelo} Bs.` });
        }

        // Lógica de IA y Menú (Integrar aquí tu lógica previa de RIF/Saldo)
        try {
            const prompt = fs.readFileSync('./instrucciones.txt', 'utf8');
            const chatIA = model.startChat({ history: [{ role: "user", parts: [{ text: prompt }] }] });
            const result = await chatIA.sendMessage(text);
            await socketBot.sendMessage(from, { text: result.response.text() });
        } catch (e) {
            console.error(e);
        }
    });
}

// ===== SERVIDOR WEB / PANEL DE CONTROL =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `<nav class="navbar navbar-dark bg-dark mb-4"><div class="container"><a class="navbar-brand" href="/">ONE4CARS BOT</a></div></nav>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
            res.end(await cobranza.generarHTML(v, z, d, header, parsedUrl.query));
        } catch (e) { res.end(`Error: ${e.message}`); }

    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method==='POST') {
        let b=''; req.on('data', c=>b+=c); 
        req.on('end', ()=>{ 
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); 
            res.end("OK"); 
        });

    } else if (parsedUrl.pathname === '/enviar-marketing' && req.method==='POST') {
        // Nuevo endpoint para Lista de Precios y Promo Personalizada
        let b=''; req.on('data', c=>b+=c);
        req.on('end', async ()=>{
            const data = JSON.parse(b);
            if(data.tipo === 'precios') await marketing.enviarListaPrecios(socketBot, data.clientes);
            if(data.tipo === 'promo') await marketing.enviarPromoPersonalizada(socketBot, data.clientes);
            res.end("OK");
        });

    } else {
        // ESTADO BOT Y QR
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(`
            <html>
            <head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body class="bg-light text-center">
            ${header}
            <div class="container py-5">
                <div class="card shadow p-4 mx-auto" style="max-width:450px;">
                    <h4>Status: ${qrCodeData === 'ONLINE ✅' ? '<span class="text-success">CONECTADO</span>' : 'ESCANEAR QR'}</h4>
                    <div class="my-4">
                        ${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" class="img-fluid border shadow">` : `<h2 class="alert alert-info">${qrCodeData}</h2>`}
                    </div>
                    <div class="d-grid gap-2">
                        <a href="/cobranza" class="btn btn-primary fw-bold">PANEL DE COBRANZA</a>
                        <button onclick="enviarMarketing('precios')" class="btn btn-outline-dark">ENVIAR CATÁLOGO A SELECCIONADOS</button>
                        <button onclick="enviarMarketing('promo')" class="btn btn-outline-info">ENVIAR PROMO WEB A SELECCIONADOS</button>
                    </div>
                </div>
            </div>
            <script>
                async function enviarMarketing(tipo) {
                    if(!confirm('¿Desea enviar esto a los clientes seleccionados en los filtros?')) return;
                    // Aquí se integra con la lógica de selección de cobranza.js
                    alert('Iniciando envío de ' + tipo);
                    // Lógica para capturar IDs y enviar al backend...
                }
            </script>
            </body></html>
        `);
    }
});

server.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    startBot();
    setInterval(obtenerDolar, 3600000); // Actualiza dólar cada hora
});
