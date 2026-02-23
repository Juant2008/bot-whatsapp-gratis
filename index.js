const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN ONE4CARS ---
const API_KEY_GEMINI = "TU_API_KEY_AQUI"; // Reemplaza con tu llave de Google AI Studio
const genAI = new GoogleGenerativeAI(API_KEY_GEMINI);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- FUNCIONES DE CONSULTA REAL SQL ---
async function obtenerContextoBD(texto, numeroWhatsApp) {
    const conn = await mysql.createConnection(dbConfig);
    let datosExtra = "Información actual de ONE4CARS: ";
    
    try {
        const busqueda = texto.toLowerCase();

        // 1. Lógica de Saldo / Deuda
        if (busqueda.includes("saldo") || busqueda.includes("debo") || busqueda.includes("cuenta")) {
            const [rows] = await conn.execute(
                `SELECT c.nombres, SUM(f.monto - f.abono_factura) as deuda 
                 FROM tab_cliente c 
                 JOIN tab_facturas f ON c.id_cliente = f.id_cliente 
                 WHERE f.pagada = 'NO' AND (c.telefono LIKE ? OR c.cedula LIKE ?)
                 GROUP BY c.id_cliente`, [`%${numeroWhatsApp.substring(2)}%`, `%${busqueda.match(/\d+/)}%`]
            );
            if (rows.length > 0) {
                datosExtra += `El cliente ${rows[0].nombres} tiene una deuda de $${rows[0].deuda}. `;
            }
        }

        // 2. Lógica de Productos (Búsqueda LIKE en descripción)
        if (busqueda.includes("precio") || busqueda.includes("tienes") || busqueda.includes("hay")) {
            const item = busqueda.replace(/precio|tienes|hay|de/g, "").trim();
            const [prod] = await conn.execute(
                "SELECT descripcion, precio, cantidad_existencia FROM tab_productos WHERE descripcion LIKE ? LIMIT 3",
                [`%${item}%`]
            );
            if (prod.length > 0) {
                datosExtra += "Resultados de inventario: " + prod.map(p => `${p.descripcion} ($${p.precio}, stock: ${p.cantidad_existencia})`).join(", ");
            }
        }
    } catch (e) { console.error("Error BD:", e); }
    finally { await conn.end(); }
    return datosExtra;
}

// --- MOTOR DEL BOT ---
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
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'open') qrCodeData = "BOT ONLINE ✅";
        if (connection === 'close') {
            const code = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const senderNumber = from.split('@')[0];
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // Obtener datos de la BD para alimentar a la IA
        const contextoBD = await obtenerContextoBD(body, senderNumber);

        // Entrenamiento dinámico para Gemini
        const promptSystem = `
        Eres el asistente inteligente de ONE4CARS (Venezuela). 
        CONTEXTO DEL SISTEMA: ${contextoBD}.
        REGLAS:
        1. Responde en lenguaje natural, amable y profesional.
        2. Si el contexto tiene datos de deuda o productos, úsalos para responder con precisión.
        3. Si no hay datos, ofrece el menú: Medios de Pago, Estado de Cuenta, Lista de Precios, Tomar Pedido.
        4. Enlaces oficiales: 
           - Medios de Pago: https://www.one4cars.com/medios_de_pago.php
           - Pedidos: https://www.one4cars.com/tomar_pedido.php
        5. No inventes precios si no están en el contexto.
        `;

        try {
            const result = await model.generateContent(`${promptSystem}\nCliente dice: ${body}`);
            const responseText = result.response.text();
            await sock.sendMessage(from, { text: responseText });
        } catch (err) {
            await sock.sendMessage(from, { text: "Hola! Estamos actualizando el sistema. Por favor intenta en un momento o escribe 'Asesor'." });
        }
    });
}

// --- SERVIDOR WEB (SIMULANDO PHP HEADER) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        // ... (Lógica de cobranza masiva que ya tenías)
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // Simulación de include/header.php
        res.write(`
            <div style="font-family:sans-serif; background:#f4f4f4; min-height:100vh;">
                <div style="background:#000; color:#fff; padding:20px; text-align:center;">
                    <img src="https://one4cars.com/logo.png" style="width:180px;"><br>
                    <h1>ONE4CARS - Panel de Control Bot</h1>
                </div>
                <div style="padding:40px; text-align:center;">
                    ${qrCodeData.includes("data:image") 
                        ? `<h2>Escanea el QR para Vincular</h2><img src="${qrCodeData}" style="border:10px solid #fff; box-shadow:0 0 10px rgba(0,0,0,0.1);">` 
                        : `<h2 style="color:green;">${qrCodeData || "Iniciando..."}</h2><br>
                           <a href="/cobranza" style="display:inline-block; padding:15px 30px; background:#28a745; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold;">IR A COBRANZA</a>`
                    }
                </div>
            </div>
        `);
        res.end();
    }
}).listen(port);

startBot();
