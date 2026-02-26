const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", 
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
});

// --- CONFIGURACIÓN DB REAL ONE4CARS ---
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- ENTRENAMIENTO COMPLETO ---
const knowledgeBase = `Eres el asistente experto de ONE4CARS. Empresa importadora de autopartes China-Venezuela.
REGLAS CRÍTICAS:
1. Si el cliente dice que busca un producto, NO vuelvas a saludar. Pregunta de inmediato: "Excelente, ¿qué repuesto busca? (Indíquenos Marca, Modelo y Año)".
2. Solo muestra el menú de 9 opciones si el cliente no sabe qué hacer o lo pide.
3. Usa la data de las tasas y saldos si están disponibles.

MENÚ (Solo bajo demanda):
1. Stock/Precios, 2. Estado de Cuenta, 3. Tasa BCV/Paralelo, 4. Pagos, 5. Catálogo, 6. Registro, 7. Tránsito, 8. Garantías, 9. Vendedores.`;

async function obtenerTasas() {
    let oficial = 0; let paralelo = 0;
    try {
        const resO = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        oficial = resO.data.promedio;
        const resP = await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo');
        paralelo = resP.data.promedio;
    } catch (e) { console.error("Error Tasas"); }
    return { oficial, paralelo };
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), browser: ["ONE4CARS", "Chrome", "1.0.0"] });
    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') qrCodeData = "ONLINE ✅";
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const tasas = await obtenerTasas();
        let contextSQL = "";

        // Consulta SQL si hay un RIF
        const rifMatch = text.match(/[JVE][-]?\d+/i);
        if (rifMatch) {
            try {
                const conn = await mysql.createConnection(dbConfig);
                const [cliente] = await conn.execute("SELECT id_cliente, nombres FROM tab_cliente WHERE REPLACE(cedula, '-', '') = ?", [rifMatch[0].replace(/-/g, '')]);
                if (cliente.length > 0) {
                    const [deuda] = await conn.execute("SELECT SUM(total - monto_pagado) as saldo FROM tab_facturas WHERE id_cliente = ? AND pagada = 'NO'", [cliente[0].id_cliente]);
                    contextSQL = `Cliente: ${cliente[0].nombres}. Saldo: $${deuda[0].saldo || 0}.`;
                }
                await conn.end();
            } catch (e) { console.log("DB Error"); }
        }

        try {
            const promptFinal = `${knowledgeBase}\nTasas: BCV ${tasas.oficial}, Paralelo ${tasas.paralelo}.\n${contextSQL}\nCliente: ${text}\nAsistente:`;
            const result = await model.generateContent(promptFinal);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) {
            // FALLBACK INTELIGENTE (Ya no repite el saludo si el cliente respondió)
            if (text.toLowerCase().includes("producto")) {
                await sock.sendMessage(from, { text: "📦 ¿Qué producto busca? Por favor indíquenos marca y modelo del vehículo." });
            } else {
                await sock.sendMessage(from, { text: "🚗 Hola, ¿en qué puedo ayudarle hoy?" });
            }
        }
    });
}

// Servidor administrativo (Header y Cobranza)
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `<header class="p-3 bg-dark text-white shadow"><div class="container d-flex justify-content-between"><h4>🚗 ONE4CARS</h4><nav><a href="/" class="text-white me-3">Estado</a><a href="/cobranza" class="btn btn-primary btn-sm">COBRANZA</a></nav></div></header>`;

    if (parsedUrl.pathname === '/cobranza') {
        const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<html><body class="bg-light">${header}<div class="container mt-4"><h3>Cobranza Real</h3><table class="table">${d.map(i => `<tr><td>${i.nombres}</td><td>$${i.saldo_pendiente}</td></tr>`).join('')}</table></div></body></html>`);
        res.end();
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body class="text-center">${header}<div class="mt-5">${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}">` : `<h1>${qrCodeData || "Iniciando..."}</h1>`}</div></body></html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
