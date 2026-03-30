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

// Importar módulos externos requeridos por el usuario
const cobranza = require('./cobranza');
const marketing = require('./marketing'); 

const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY;

// Configuración de IA
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", // Versión estable y rápida
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 } 
});

// Configuración DB (Datos proporcionados por el usuario)
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// Variables de estado
let qrCodeData = "Iniciando...";
let socketBot = null;
let dolarInfo = { bcv: '---', paralelo: '---' };

// ===== FUNCIONES DE BASE DE DATOS =====
async function db() {
    return await mysql.createConnection(dbConfig);
}

async function getSesion(tel) {
    const conn = await db();
    try {
        const [r] = await conn.execute("SELECT * FROM control_chat WHERE telefono=?", [tel]);
        return r[0] || null;
    } finally { await conn.end(); }
}

async function setModo(tel, modo) {
    const conn = await db();
    try {
        await conn.execute(`
            INSERT INTO control_chat (telefono, modo)
            VALUES (?,?)
            ON DUPLICATE KEY UPDATE modo=VALUES(modo)
        `, [tel, modo]);
    } finally { await conn.end(); }
}

async function guardarUsuario(tel, usuario) {
    const conn = await db();
    try {
        await conn.execute(`
            INSERT INTO control_chat (telefono, usuario, modo)
            VALUES (?,?, 'bot')
            ON DUPLICATE KEY UPDATE usuario=VALUES(usuario)
        `, [tel, usuario]);
    } finally { await conn.end(); }
}

async function buscarCliente(usuario) {
    const conn = await db();
    try {
        const [r] = await conn.execute("SELECT id_cliente, nombres, usuario FROM tab_clientes WHERE usuario=? LIMIT 1", [usuario]);
        return r[0] || null;
    } finally { await conn.end(); }
}

async function obtenerSaldo(id) {
    const conn = await db();
    try {
        const [r] = await conn.execute("SELECT SUM(total - abono_factura) saldo FROM tab_facturas WHERE id_cliente=? AND pagada='NO'", [id]);
        return r[0].saldo || 0;
    } finally { await conn.end(); }
}

// ===== API DÓLAR (BCV Y PARALELO) =====
async function obtenerTasaDolar() {
    try {
        const res = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        dolarInfo.bcv = res.data.monitors.bcv.price;
        dolarInfo.paralelo = res.data.monitors.enparalelovzla.price;
        console.log(`Tasas actualizadas: BCV ${dolarInfo.bcv} | Paralelo ${dolarInfo.paralelo}`);
    } catch (e) { console.log("Error API Dólar:", e.message); }
}

// ===== CONEXIÓN WHATSAPP =====
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

        if (qr) {
            // Generar QR de alta calidad
            qrcode.toDataURL(qr, { scale: 10, margin: 2 }, (err, url) => {
                if (!err) qrCodeData = url;
            });
        }

        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("ONE4CARS BOT CONECTADO");
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const from = msg.key.remoteJid;
        
        // 1. IGNORAR MENSAJES DE GRUPOS
        if (from.endsWith('@g.us')) return;

        const tel = from.split('@')[0];

        // 2. DETECTAR CONTROL HUMANO
        // Si nosotros enviamos un mensaje desde el teléfono conectado, el bot entra en modo humano
        if (msg.key.fromMe) {
            console.log(`Detectado mensaje saliente a ${tel}. Activando MODO HUMANO.`);
            await setModo(tel, 'humano');
            return;
        }

        // 3. VERIFICAR SI EL BOT DEBE RESPONDER
        const sesion = await getSesion(tel);
        if (sesion && sesion.modo === 'humano') return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        // Comandos de consulta rápida
        if (text.toLowerCase() === 'dolar' || text.toLowerCase() === 'tasa') {
            return await socketBot.sendMessage(from, { text: `💵 *Tasa BCV:* ${dolarInfo.bcv} Bs.\n📈 *Paralelo:* ${dolarInfo.paralelo} Bs.` });
        }

        // FLUJO DE NEGOCIO
        if (!sesion || !sesion.usuario) {
            const cedula = text.replace(/\D/g, '');
            if (cedula.length >= 6) {
                const cliente = await buscarCliente(cedula);
                if (cliente) {
                    await guardarUsuario(tel, cedula);
                    await socketBot.sendMessage(from, { text: `Hola ${cliente.nombres} 👋. RIF vinculado.\nEscriba *saldo* para ver su deuda o *menu* para opciones.` });
                } else {
                    await socketBot.sendMessage(from, { text: "No encontramos su RIF. Por favor envíe su número de RIF/Cédula correctamente." });
                }
            } else {
                await socketBot.sendMessage(from, { text: "👋 Bienvenido a ONE4CARS.\nPor favor envíe su RIF o Cédula para identificarse." });
            }
            return;
        }

        // SALDO
        if (text.toLowerCase().includes("saldo")) {
            const cliente = await buscarCliente(sesion.usuario);
            const saldo = await obtenerSaldo(cliente.id_cliente);
