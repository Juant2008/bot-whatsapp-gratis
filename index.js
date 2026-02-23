// index.js - ONE4CARS CORREGIDO PARA RENDER
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const mysql = require('mysql2/promise'); // Para conectar con tu base de datos
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE BASE DE DATOS ONE4CARS ---
const dbConfig = {
    host: 'localhost', // Cambiar por tu host de HostGator si es remoto
    user: 'root', 
    password: '', 
    database: 'one4cars_db'
};

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// Función para simular el header en las respuestas HTML
function getHeaderHTML(titulo) {
    return `
        <header style="background: #000; color: #fff; padding: 20px; text-align: center;">
            <img src="https://www.one4cars.com/logo.png" alt="ONE4CARS" width="150">
            <h1>${titulo}</h1>
        </header>
    `;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // --- LÓGICA DE RESPUESTAS INTELIGENTES ---
        const tituloWS = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";

        // Si el cliente pregunta por "Saldo"
        if (body.includes("saldo") || body.includes("debo")) {
            await sock.sendMessage(from, { text: tituloWS + "Estimado cliente, por favor indique su *RIF o Cédula* para consultar su saldo actual en el sistema." });
            return;
        }

        // Respuestas rápidas de enlaces
        const respuestas = {
            'medios de pago': '🔗 https://www.one4cars.com/medios_de_pago.php',
            'estado de cuenta': '🔗 https://www.one4cars.com/estado_de_cuenta.php',
            'lista de precio': '🔗 https://www.one4cars.com/lista_de_precios.php',
            'tomar pedido': '🔗 https://www.one4cars.com/tomar_pedido.php'
        };

        for (const [key, val] of Object.entries(respuestas)) {
            if (body.includes(key)) {
                await sock.sendMessage(from, { text: tituloWS + val });
                return;
            }
        }

        // Menú Principal
        const saludos = ['hola', 'buendia', 'saludos', 'buenas'];
        if (saludos.some(s => body.includes(s))) {
            const menu = '¡Hola! Bienvenido a *ONE4CARS* 🚗\n\n' +
                         'Escribe una palabra clave:\n' +
                         '💰 *Saldo*\n' +
                         '🏦 *Medios de Pago*\n' +
                         '📄 *Estado de Cuenta*\n' +
                         '🛒 *Tomar Pedido*';
            await sock.sendMessage(from, { text: menu });
        }
    });
}

// SERVIDOR HTTP
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (path === '/cobranza') {
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.write(getHeaderHTML("Panel de Cobranza"));
        res.write(`<div style="padding:20px;">
            <h2>Lista de Deudores</h2>
            <table border="1" style="width:100%; border-collapse:collapse;">
                ${deudores.map(d => `<tr><td>${d.nombres}</td><td>$${d.saldo_pendiente}</td></tr>`).join('')}
            </table>
            <br><a href="/">Volver</a>
        </div>`);
        res.end();
    } 
    else {
        // Pantalla Principal (QR)
        res.write(getHeaderHTML("Conexión del Bot"));
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h3>Escanea para conectar</h3><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center><h3>Estatus: ${qrCodeData || "Iniciando..."}</h3><br>
            <a href="/cobranza" style="background:green; color:white; padding:10px; text-decoration:none;">IR A COBRANZA</a></center>`);
        }
        res.end();
    }
}).listen(port);

startBot();
