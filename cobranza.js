const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const mysql = require('mysql2/promise');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== CONFIG =====
const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY || "";

// ===== IA =====
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ===== DB =====
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// ===== VARIABLES =====
let qrCodeData = "Iniciando...";
let sockGlobal = null;

// ===== HELPERS =====
function limpiarCedula(texto) {
    return texto.replace(/\D/g, '');
}

async function db() {
    return await mysql.createConnection(dbConfig);
}

async function getSesion(tel) {
    const conn = await db();
    const [r] = await conn.execute("SELECT * FROM control_chat WHERE telefono=?", [tel]);
    await conn.end();
    return r[0] || null;
}

async function setModo(tel, modo) {
    const conn = await db();
    await conn.execute(`
        INSERT INTO control_chat (telefono, modo)
        VALUES (?,?)
        ON DUPLICATE KEY UPDATE modo=VALUES(modo)
    `, [tel, modo]);
    await conn.end();
}

async function guardarUsuario(tel, usuario) {
    const conn = await db();
    await conn.execute(`
        INSERT INTO control_chat (telefono, usuario, modo)
        VALUES (?,?, 'bot')
        ON DUPLICATE KEY UPDATE usuario=VALUES(usuario)
    `, [tel, usuario]);
    await conn.end();
}

async function buscarCliente(usuario) {
    const conn = await db();
    const [r] = await conn.execute(
        "SELECT id_cliente, nombres FROM tab_clientes WHERE usuario=? LIMIT 1",
        [usuario]
    );
    await conn.end();
    return r[0] || null;
}

// 🔥 DETERMINA QUÉ FACTURAS MOSTRAR (CORRECCIÓN EBENEZER)
async function obtenerSaldo(id, diasVencimiento = 0) {
    const conn = await db();
    // Filtramos factura por factura usando DATEDIFF
    // Si pides facturas de >60 días, la de 24 días será ignorada en la suma
    const [r] = await conn.execute(
        `SELECT SUM(total - abono_factura) as saldo 
         FROM tab_facturas 
         WHERE id_cliente=? AND pagada='NO' AND anulado='no' 
         AND DATEDIFF(CURDATE(), fecha_reg) >= ?`,
        [id, diasVencimiento]
    );
    await conn.end();
    return r[0].saldo || 0;
}

async function getChats() {
    const conn = await db();
    const [r] = await conn.execute("SELECT * FROM control_chat ORDER BY updated_at DESC");
    await conn.end();
    return r;
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

    sockGlobal = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (_, url) => qrCodeData = url);
        if (connection === 'open') { qrCodeData = "ONLINE ✅"; }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return;
        const tel = from.split('@')[0];

        if (msg.key.fromMe) {
            await setModo(tel, 'humano');
            return;
        }

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        const sesion = await getSesion(tel);
        if (sesion && sesion.modo === 'humano') return;

        if (!sesion) {
            await sock.sendMessage(from, { text: "👋 Bienvenido a ONE4CARS 🚗\n\nEnvíe su RIF o escriba *menu*" });
            await setModo(tel, 'bot'); return;
        }

        if (text.toLowerCase().includes("menu")) {
            await sock.sendMessage(from, { text: "📋 MENÚ:\n1 Pagos\n2 Estado de cuenta\n3 Precios\n4 Pedidos\n6 Registro\n8 Despacho" });
            return;
        }

        if (!sesion.usuario) {
            const cedula = limpiarCedula(text);
            if (cedula.length >= 6) {
                const cliente = await buscarCliente(cedula);
                if (cliente) {
                    await guardarUsuario(tel, cedula);
                    await sock.sendMessage(from, { text: `Hola ${cliente.nombres} 👋\nEscriba *saldo* para consultar` });
                    return;
                }
            }
            await sock.sendMessage(from, { text: "🔐 Envíe su RIF para continuar" });
            return;
        }

        const cliente = await buscarCliente(sesion.usuario);

        if (text.toLowerCase().includes("saldo")) {
            // Aquí traemos el saldo que tenga al menos 1 día de emitida (puedes cambiar el 0 por 60 si quieres el reporte de mora)
            const saldo = await obtenerSaldo(cliente.id_cliente, 0);
            await sock.sendMessage(from, { text: `💰 Su saldo pendiente es: $${saldo.toFixed(2)}` });
            return;
        }

        try {
            const instrucciones = fs.readFileSync('./instrucciones.txt', 'utf8');
            const chat = model.startChat({ history: [{ role: "user", parts: [{ text: instrucciones }] }] });
            const r = await chat.sendMessage(text);
            await sock.sendMessage(from, { text: r.response.text() });
        } catch {
            await sock.sendMessage(from, { text: "⚠️ Error, escriba menu." });
        }
    });
}

// Exportamos las funciones para que index.js las use sin duplicar el servidor
module.exports = { startBot, obtenerSaldo, buscarCliente };

// 🔥 IMPORTANTE: Si este archivo se ejecuta solo (node cobranza.js), arranca el servidor.
// Si se importa desde index.js, no arranca un segundo servidor (evita el error EADDRINUSE).
if (require.main === module) {
    const server = http.createServer(async (req, res) => {
        const parsed = url.parse(req.url, true);
        if (parsed.pathname === '/panel') {
            const chats = await getChats();
            res.end(`<h2>Panel</h2>${chats.map(c => `<p>${c.telefono} - ${c.modo}</p>`).join('')}`);
            return;
        }
        res.end(`<h2>BOT ONLINE</h2>${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" width="250">` : `<h3>${qrCodeData}</h3>`}`);
    });

    server.listen(PORT, () => {
        console.log("Servidor cobranza corriendo en puerto", PORT);
        startBot();
    });
}
