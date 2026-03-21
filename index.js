const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// ================= CONFIG =================
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
});

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let qrCodeData = "Generando QR...";
let socketBot = null;
const port = process.env.PORT || 10000;

// ================= FUNCIONES =================

function limpiarCedula(texto) {
    return texto.replace(/\D/g, '');
}

async function obtenerSesion(telefono) {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`SELECT * FROM control_chat WHERE telefono = ?`, [telefono]);
    await conn.end();
    return rows[0] || null;
}

async function guardarSesion(telefono, usuario) {
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute(`
        INSERT INTO control_chat (telefono, usuario, modo)
        VALUES (?, ?, 'bot')
        ON DUPLICATE KEY UPDATE usuario = VALUES(usuario)
    `, [telefono, usuario]);
    await conn.end();
}

async function cambiarModo(telefono, modo) {
    const conn = await mysql.createConnection(dbConfig);
    await conn.execute(`
        INSERT INTO control_chat (telefono, modo)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE modo = VALUES(modo)
    `, [telefono, modo]);
    await conn.end();
}

async function esHumano(telefono) {
    const s = await obtenerSesion(telefono);
    return s && s.modo === 'humano';
}

async function buscarCliente(usuario) {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
        SELECT id_cliente, nombres, usuario 
        FROM tab_clientes 
        WHERE usuario = ? LIMIT 1
    `, [usuario]);
    await conn.end();
    return rows[0] || null;
}

async function obtenerSaldo(id_cliente) {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
        SELECT SUM(total - abono_factura) as saldo
        FROM tab_facturas
        WHERE id_cliente = ? AND pagada='NO'
    `, [id_cliente]);
    await conn.end();
    return rows[0].saldo || 0;
}

async function obtenerChats() {
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
        SELECT telefono, usuario, modo, updated_at 
        FROM control_chat
        ORDER BY updated_at DESC
    `);
    await conn.end();
    return rows;
}

// ================= BOT =================

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    socketBot = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr) {
            qrcode.toDataURL(qr, (err, url) => {
                qrCodeData = url;
            });
        }

        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("Bot conectado");
        }

        if (connection === 'close') {
            const shouldReconnect =
                (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return;

        let telefono = from.split('@')[0];
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        if (await esHumano(telefono)) return;

        let sesion = await obtenerSesion(telefono);

        // SALUDO
        if (!sesion) {
            await sock.sendMessage(from, {
                text: "👋 Bienvenido a ONE4CARS 🚗\n\nEscribe *menu* o envía tu RIF para comenzar."
            });
        }

        // MENU
        if (text.toLowerCase().includes("menu")) {
            await sock.sendMessage(from, {
                text: `📋 MENÚ:

1️⃣ Pagos:
https://www.one4cars.com/medios_de_pago.php/

2️⃣ Estado de cuenta:
https://www.one4cars.com/estado_de_cuenta.php/

3️⃣ Lista de precios:
https://www.one4cars.com/lista_de_precios.php/

4️⃣ Pedidos:
https://www.one4cars.com/tomar_pedido.php/

6️⃣ Registro:
https://www.one4cars.com/afiliar_clientes.php/

8️⃣ Despacho:
https://www.one4cars.com/despacho.php/`
            });
            return;
        }

        // IDENTIFICAR
        if (!sesion || !sesion.usuario) {
            const cedula = limpiarCedula(text);

            if (cedula.length >= 6) {
                const cliente = await buscarCliente(cedula);

                if (cliente) {
                    await guardarSesion(telefono, cliente.usuario);

                    await sock.sendMessage(from, {
                        text: `Hola ${cliente.nombres} 👋\nYa estás identificado en el sistema 🚗`
                    });
                    return;
                }
            }

            await sock.sendMessage(from, {
                text: "🔐 Indique su RIF o cédula para continuar."
            });
            return;
        }

        const cliente = await buscarCliente(sesion.usuario);

        // SALDO
        if (cliente && text.toLowerCase().includes("saldo")) {
            const saldo = await obtenerSaldo(cliente.id_cliente);

            await sock.sendMessage(from, {
                text: `💰 Hola ${cliente.nombres}\n\nSaldo pendiente: $${saldo.toFixed(2)}`
            });
            return;
        }

        // IA
        try {
            const instrucciones = fs.readFileSync('./instrucciones.txt', 'utf8');

            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: instrucciones }] }
                ]
            });

            const result = await chat.sendMessage(text);
            const response = result.response.text();

            await sock.sendMessage(from, { text: response });

        } catch (e) {
            await sock.sendMessage(from, { text: "⚠️ Error temporal." });
        }
    });
}

// ================= SERVER =================

const server = http.createServer(async (req, res) => {

    const parsed = url.parse(req.url, true);

    // PANEL CONTROL
    if (parsed.pathname === '/panel') {

        const chats = await obtenerChats();

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

        res.end(`
        <html>
        <body>
        <h2>Panel Control</h2>
        ${chats.map(c => `
            <p>${c.telefono} - ${c.modo}
            <a href="/modo?tel=${c.telefono}&modo=${c.modo === 'bot' ? 'humano' : 'bot'}">Cambiar</a></p>
        `).join('')}
        </body>
        </html>
        `);
        return;
    }

    // CAMBIAR MODO
    if (parsed.pathname === '/modo') {
        await cambiarModo(parsed.query.tel, parsed.query.modo);
        res.end("OK");
        return;
    }

    // PANEL COBRANZA
    if (parsed.pathname === '/cobranza') {
        const d = await cobranza.obtenerListaDeudores({});
        res.end(`<h2>Cobranza (${d.length})</h2>`);
        return;
    }

    // HOME (QR)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    res.end(`
    <html>
    <body style="text-align:center;background:#111;color:white">
        <h2>ONE4CARS BOT</h2>
        ${
            qrCodeData.startsWith('data')
            ? `<img src="${qrCodeData}" width="250">`
            : `<h3>${qrCodeData}</h3>`
        }
        <br><br>
        <a href="/panel">Panel Control</a><br>
        <a href="/cobranza">Cobranza</a>
    </body>
    </html>
    `);

});

server.listen(port, () => {
    console.log("Servidor listo");
    startBot();
});