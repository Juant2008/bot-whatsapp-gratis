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

// MODULOS PROPIOS
const cobranza = require('./cobranza');

// CONFIGURACION
const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", 
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 } 
});

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// VARIABLES GLOBALES
let qrCodeData = "Iniciando...";
let socketBot = null;
let dolarInfo = { bcv: '0', paralelo: '0' };

// ===== BASE DE DATOS =====
async function db() { return await mysql.createConnection(dbConfig); }

async function getSesion(tel) {
    const conn = await db();
    const [r] = await conn.execute("SELECT * FROM control_chat WHERE telefono=?", [tel]);
    await conn.end();
    return r[0] || null;
}

async function setModo(tel, modo) {
    const conn = await db();
    await conn.execute("INSERT INTO control_chat (telefono, modo) VALUES (?,?) ON DUPLICATE KEY UPDATE modo=VALUES(modo)", [tel, modo]);
    await conn.end();
}

async function guardarUsuario(tel, usuario) {
    const conn = await db();
    await conn.execute("INSERT INTO control_chat (telefono, usuario, modo) VALUES (?,?, 'bot') ON DUPLICATE KEY UPDATE usuario=VALUES(usuario)", [tel, usuario]);
    await conn.end();
}

async function buscarCliente(usuario) {
    const conn = await db();
    const [r] = await conn.execute("SELECT * FROM tab_clientes WHERE usuario=? LIMIT 1", [usuario]);
    await conn.end();
    return r[0] || null;
}

async function obtenerSaldo(id) {
    const conn = await db();
    const [r] = await conn.execute("SELECT SUM(total - abono_factura) saldo FROM tab_facturas WHERE id_cliente=? AND pagada='NO'", [id]);
    await conn.end();
    return r[0].saldo || 0;
}

// ===== API DOLAR =====
async function actualizarDolar() {
    try {
        const res = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        dolarInfo.bcv = res.data.monitors.bcv.price;
        dolarInfo.paralelo = res.data.monitors.enparalelovzla.price;
    } catch (e) { console.error("Error Dolar:", e.message); }
}

// ===== MARKETING & PRECIOS =====
async function enviarListaPrecios(sock, clientesIds) {
    const pdfPath = './sevencorpweb/uploads/precios/Catalogo - ONE4CARS_compressed.pdf';
    for (const id of clientesIds) {
        const conn = await db();
        const [r] = await conn.execute("SELECT telefono FROM tab_clientes WHERE id_cliente=?", [id]);
        await conn.end();
        if (r[0]) {
            await sock.sendMessage(`${r[0].telefono}@s.whatsapp.net`, {
                document: fs.readFileSync(pdfPath),
                fileName: 'Catalogo-ONE4CARS.pdf',
                mimetype: 'application/pdf',
                caption: 'Aquí tienes nuestro catálogo actualizado. 🚀'
            });
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

async function enviarPromoPersonalizada(sock, clientesIds) {
    for (const id of clientesIds) {
        const conn = await db();
        const [r] = await conn.execute("SELECT * FROM tab_clientes WHERE id_cliente=?", [id]);
        await conn.end();
        if (r[0]) {
            const msg = `*🛠️ ¡Tu Negocio, al Máximo Nivel con ONE4CARS!*

¡Hola *${r[0].nombres}*! 👋

Recibe un cordial saludo de la gerencia de ventas de *ONE4CARS*.

Somos tu fuente principal de repuestos:
• *Filtración* • *Motor* • *Chasis* • *Electricidad*

*🌐 Acceso a tu Portal Mayorista:*
*Enlace:* https://one4cars.com/mayoristas
*LOGIN:* ${r[0].usuario}
*PASSWORD:* ${r[0].clave || 'Notiene'}

*🚀 Tu página personalizada:*
➡️ https://www.one4cars.com/${r[0].usuario}`;

            await sock.sendMessage(`${r[0].telefono}@s.whatsapp.net`, { text: msg });
            await new Promise(res => setTimeout(res, 2000));
        }
    }
}

// ===== BOT WHATSAPP =====
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (_, url) => qrCodeData = url);
        if (connection === 'open') { qrCodeData = "ONLINE ✅"; console.log("Bot Conectado"); }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const from = msg.key.remoteJid;

        // 1. IGNORAR GRUPOS
        if (from.includes('@g.us')) return;

        const tel = from.split('@')[0];

        // 2. CONTROL HUMANO: Si yo escribo, el bot se calla para ese cliente
        if (msg.key.fromMe) {
            await setModo(tel, 'humano');
            return;
        }

        const sesion = await getSesion(tel);
        if (sesion && sesion.modo === 'humano') return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        // COMANDO DOLAR
        if (text.toLowerCase().includes("dolar")) {
            await actualizarDolar();
            await sock.sendMessage(from, { text: `💵 BCV: ${dolarInfo.bcv} | Paralelo: ${dolarInfo.paralelo}` });
            return;
        }

        // LÓGICA DE IDENTIFICACIÓN Y IA
        if (!sesion || !sesion.usuario) {
            const cedula = text.replace(/\D/g, '');
            if (cedula.length >= 6) {
                const cliente = await buscarCliente(cedula);
                if (cliente) {
                    await guardarUsuario(tel, cedula);
                    await sock.sendMessage(from, { text: `Hola ${cliente.nombres} 👋. Escriba *saldo* o su duda.` });
                    return;
                }
            }
            await sock.sendMessage(from, { text: "Bienvenido a ONE4CARS. Por favor envíe su RIF o Cédula." });
            return;
        }

        // SALDO
        if (text.toLowerCase().includes("saldo")) {
            const cliente = await buscarCliente(sesion.usuario);
            const saldo = await obtenerSaldo(cliente.id_cliente);
            await sock.sendMessage(from, { text: `💰 Su saldo es: $${saldo.toFixed(2)}` });
            return;
        }

        // IA
        try {
            const instrucciones = fs.readFileSync('./instrucciones.txt', 'utf8');
            const result = await model.generateContent(`${instrucciones}\n\nCliente: ${text}`);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.log("Error IA"); }
    });
}

// ===== SERVIDOR WEB =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `<nav class="navbar navbar-dark bg-dark mb-4"><div class="container"><a class="navbar-brand">ONE4CARS ADMIN</a></div></nav>`;

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
        req.on('end', ()=>{ cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); res.end("OK"); });

    } else if (parsedUrl.pathname === '/marketing' && req.method==='POST') {
        let b=''; req.on('data', c=>b+=c);
        req.on('end', async ()=>{
            const data = JSON.parse(b);
            if(data.tipo === 'precios') await enviarListaPrecios(socketBot, data.clientes);
            if(data.tipo === 'promo') await enviarPromoPersonalizada(socketBot, data.clientes);
            res.end("OK");
        });

    } else {
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(`<html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <meta http-equiv="refresh" content="10"></head><body class="bg-light text-center">${header}
        <div class="container py-5"><div class="card shadow p-4 mx-auto" style="max-width:450px;">
        <h4 class="mb-4">Status</h4><div>
        ${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" width="250">` : `<h2 class="text-success">${qrCodeData}</h2>`}
        </div><hr><p class="small">Dolar BCV: ${dolarInfo.bcv} | Par: ${dolarInfo.paralelo}</p>
        <a href="/cobranza" class="btn btn-primary w-100 fw-bold">PANEL COBRANZA</a>
        </div></div></body></html>`);
    }
});

// ARRANQUE SEGURO
server.listen(PORT, () => {
    console.log(`Puerto ${PORT} abierto.`);
    startBot();
    actualizarDolar();
    setInterval(actualizarDolar, 3600000);
});

// Manejo de errores para evitar el bucle del puerto ocupado
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('Esperando liberación de puerto...');
        process.exit(1); // Render reiniciará el proceso automáticamente de forma limpia
    }
});
