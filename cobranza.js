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

// CONFIG
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let qrCodeData = "Generando QR...";
let socketBot = null;
const port = process.env.PORT || 10000;

// ===== FUNCIONES =====

function limpiarCedula(texto) {
    return texto.replace(/\D/g, '');
}

async function getConn() {
    return await mysql.createConnection(dbConfig);
}

async function obtenerSesion(telefono) {
    const conn = await getConn();
    const [rows] = await conn.execute(`SELECT * FROM control_chat WHERE telefono=?`, [telefono]);
    await conn.end();
    return rows[0] || null;
}

async function guardarUsuario(telefono, usuario) {
    const conn = await getConn();
    await conn.execute(`
        INSERT INTO control_chat (telefono, usuario, modo)
        VALUES (?, ?, 'bot')
        ON DUPLICATE KEY UPDATE usuario=VALUES(usuario)
    `, [telefono, usuario]);
    await conn.end();
}

async function cambiarModo(telefono, modo) {
    const conn = await getConn();
    await conn.execute(`
        INSERT INTO control_chat (telefono, modo)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE modo=VALUES(modo)
    `, [telefono, modo]);
    await conn.end();
}

async function esHumano(telefono) {
    const s = await obtenerSesion(telefono);
    return s && s.modo === 'humano';
}

async function buscarCliente(usuario) {
    const conn = await getConn();
    const [rows] = await conn.execute(
        `SELECT id_cliente, nombres, usuario FROM tab_clientes WHERE usuario=? LIMIT 1`,
        [usuario]
    );
    await conn.end();
    return rows[0] || null;
}

async function obtenerSaldo(id_cliente) {
    const conn = await getConn();
    const [rows] = await conn.execute(
        `SELECT SUM(total - abono_factura) saldo FROM tab_facturas WHERE id_cliente=? AND pagada='NO'`,
        [id_cliente]
    );
    await conn.end();
    return rows[0].saldo || 0;
}

async function obtenerChats() {
    const conn = await getConn();
    const [rows] = await conn.execute(`SELECT * FROM control_chat ORDER BY updated_at DESC`);
    await conn.end();
    return rows;
}

// ===== BOT =====

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

        if (qr) qrcode.toDataURL(qr, (_, url) => qrCodeData = url);

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
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return;

        let telefono = from.split('@')[0];

        // 🔴 SI ES TUYO → ACTIVA HUMANO
        if (msg.key.fromMe) {
            await cambiarModo(telefono, 'humano');
            console.log("Humano activado:", telefono);
            return;
        }

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        if (await esHumano(telefono)) return;

        let sesion = await obtenerSesion(telefono);

        // SALUDO
        if (!sesion) {
            await sock.sendMessage(from, {
                text: "👋 Bienvenido a ONE4CARS 🚗\n\nEscribe *menu* o envía tu RIF."
            });
        }

        // MENU
        if (text.toLowerCase().includes("menu")) {
            await sock.sendMessage(from, {
                text: "📋 MENÚ:\n1 Pagos\n2 Estado\n3 Precios\n4 Pedidos\n6 Registro\n8 Despacho"
            });
            return;
        }

        // IDENTIFICACIÓN
        if (!sesion || !sesion.usuario) {
            const cedula = limpiarCedula(text);

            if (cedula.length >= 6) {
                const cliente = await buscarCliente(cedula);

                if (cliente) {
                    await guardarUsuario(telefono, cliente.usuario);

                    await sock.sendMessage(from, {
                        text: `Hola ${cliente.nombres} 👋`
                    });
                    return;
                }
            }

            await sock.sendMessage(from, {
                text: "🔐 Indique su RIF para continuar."
            });
            return;
        }

        const cliente = await buscarCliente(sesion.usuario);

        // SALDO
        if (cliente && text.toLowerCase().includes("saldo")) {
            const saldo = await obtenerSaldo(cliente.id_cliente);

            await sock.sendMessage(from, {
                text: `💰 Saldo pendiente: $${saldo.toFixed(2)}`
            });
            return;
        }

        // IA
        try {
            const instrucciones = fs.readFileSync('./instrucciones.txt', 'utf8');

            const chat = model.startChat({
                history: [{ role: "user", parts: [{ text: instrucciones }] }]
            });

            const result = await chat.sendMessage(text);
            const response = result.response.text();

            await sock.sendMessage(from, { text: response });

        } catch {
            await sock.sendMessage(from, { text: "⚠️ Error, escribe menu." });
        }
    });
}

// ===== SERVER =====

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);

    // PANEL CONTROL
    if (parsed.pathname === '/panel') {
        const chats = await obtenerChats();

        res.writeHead(200, { 'Content-Type': 'text/html' });

        res.end(`
        <h2>Panel</h2>
        ${chats.map(c => `
            <p>${c.telefono} - ${c.modo}
            <a href="/modo?tel=${c.telefono}&modo=${c.modo === 'bot' ? 'humano' : 'bot'}">Cambiar</a></p>
        `).join('')}
        `);
        return;
    }

    // CAMBIAR MODO
    if (parsed.pathname === '/modo') {
        await cambiarModo(parsed.query.tel, parsed.query.modo);
        res.end("OK");
        return;
    }

    // COBRANZA
    if (parsed.pathname === '/cobranza') {
        const d = await cobranza.obtenerListaDeudores({});
        res.end(`<h2>Cobranza (${d.length})</h2>`);
        return;
    }

    // HOME QR
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
    <h2>ONE4CARS BOT</h2>
    ${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" width="250">` : `<h3>${qrCodeData}</h3>`}
    <br><br>
    <a href="/panel">Panel</a> |
    <a href="/cobranza">Cobranza</a>
    `);
});

server.listen(port, () => {
    console.log("Servidor activo");
    startBot();
});