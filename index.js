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
    model: "gemini-1.5-flash", // Versión estable para producción
    generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
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

// --- ENTRENAMIENTO COMPLETO ONE4CARS (Instrucciones de no repetición) ---
const knowledgeBase = `Eres el asistente experto de ONE4CARS. Empresa importadora de autopartes China-Venezuela.
UBICACIÓN: Almacén General y Almacén Intermedio en Caracas.

REGLAS DE ORO:
1. HUMANIZACIÓN: Saluda cordialmente (🚗, 📦). No envíes el menú de inmediato. Pregunta si desean ver las opciones o si buscan algo específico.
2. NO REPETICIÓN: Si el cliente dice "gracias", "perfecto" o "entendido", despídete amablemente sin el menú. Solo envía las 9 opciones si el cliente acepta o está perdido.
3. FILTRO MAYORISTA: Venta mínima 100$.
4. PRODUCTOS: Bombas de gasolina, Bujías, Correas, Crucetas, Filtros, Muñones, Rodamientos, etc.

MENÚ DE 9 OPCIONES:
1. Consultar Stock/Precios (Pedir RIF y Modelo de Carro).
2. Estado de Cuenta (Saldo de facturas en tab_facturas).
3. Tasa del día (BCV y Paralelo).
4. Métodos de Pago: https://www.one4cars.com/medios_de_pago.php/
5. Catálogo Digital: https://one4cars.com/buscar/
6. Registro Nuevo: (RIF, Cédula, Foto local, 2 Referencias).
7. Mercancía en Tránsito: https://one4cars.com/sevencorpweb/productos_transito_web.php
8. Garantías y Fletes: (Caracas gratis, interior cobro destino).
9. Asesor Humano: Un operador revisará su caso.`;

// --- OBTENCIÓN DE TASA BCV Y PARALELO (Real, no simulado) ---
async function obtenerTasas() {
    let oficial = 0; let paralelo = 0;
    try {
        const resO = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial');
        oficial = resO.data.promedio;
        const resP = await axios.get('https://ve.dolarapi.com/v1/dolares/paralelo');
        paralelo = resP.data.promedio;
    } catch (e) { console.error("Error Tasas:", e.message); }
    return { oficial, paralelo };
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, auth: state, logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') qrCodeData = "ONLINE ✅";
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        const tasas = await obtenerTasas();
        let contextSQL = "";

        // Búsqueda de RIF para consulta de saldo real
        const rifMatch = text.match(/[JVE][-]?\d+/i);
        if (rifMatch) {
            try {
                const conn = await mysql.createConnection(dbConfig);
                const rif = rifMatch[0].replace(/-/g, '');
                const [cliente] = await conn.execute("SELECT id_cliente, nombres FROM tab_cliente WHERE REPLACE(cedula, '-', '') = ?", [rif]);
                if (cliente.length > 0) {
                    const [deuda] = await conn.execute("SELECT SUM(total - monto_pagado) as saldo FROM tab_facturas WHERE id_cliente = ? AND pagada = 'NO' AND anulado = 'no'", [cliente[0].id_cliente]);
                    contextSQL = `SISTEMA: Cliente ${cliente[0].nombres}. Saldo Pendiente: $${deuda[0].saldo || 0}.`;
                }
                await conn.end();
            } catch (e) { console.log("DB Error"); }
        }

        try {
            const promptFinal = `${knowledgeBase}\n\nCONTEXTO REAL:\nTasas: BCV Bs.${tasas.oficial}, Paralelo Bs.${tasas.paralelo}.\n${contextSQL}\n\nCliente: ${text}\nAsistente ONE4CARS:`;
            const result = await model.generateContent(promptFinal);
            const response = await result.response;
            await sock.sendMessage(from, { text: response.text() });
        } catch (e) {
            // Fallback manual si falla la IA (Basado en el index original)
            await sock.sendMessage(from, { text: "🚗 Hola, estamos validando su solicitud. ¿Desea ver el menú de opciones o busca un producto?" });
        }
    });
}

// --- SERVIDOR ADMINISTRATIVO (INCLUYE HEADER Y COBRANZA) ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Panel Administrativo</span>
                </div>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none small">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm fw-bold">COBRANZA</a>
                </nav>
            </div>
        </header>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`<html><head><title>Cobranza</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
                <body class="bg-light">${header}<div class="container bg-white shadow p-4 rounded-3">
                <h3>Gestión de Cobranza</h3>
                <table class="table table-hover mt-3">
                <thead class="table-dark"><tr><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr></thead>
                <tbody>${d.map(i => `<tr><td><small>${i.nombres}</small></td><td>${i.nro_factura}</td><td class="text-danger">$${i.saldo_pendiente}</td><td>${i.dias_transcurridos}</td></tr>`).join('')}</tbody>
                </table></div></body></html>`);
            res.end();
        } catch (e) { res.end(`Error: ${e.message}`); }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => { cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); res.end("OK"); });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body class="bg-light text-center">${header}
            <div class="container py-5"><div class="card shadow p-4 mx-auto" style="max-width: 450px;">
            ${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" style="width: 250px;">` : `<div class="alert alert-success h2">${qrCodeData || "Iniciando..."}</div>`}
            <hr><a href="/cobranza" class="btn btn-primary w-100">IR AL PANEL DE COBRANZA</a></div></div></body></html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
