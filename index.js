const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const fs = require('fs');
const mysql = require('mysql2/promise');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Módulos requeridos (Asegúrate de que estos archivos existan en tu repo)
const cobranza = require('./cobranza');
const marketing = require('./marketing'); // Programa para lista de precios y promociones

// Configuración inicial
const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash", // Ajustado a modelo disponible (puedes cambiarlo a 2.0-flash)
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 } 
});

// Configuración DB
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// Variables Globales
let qrCodeData = "Iniciando...";
let socketBot = null;
let dolarInfo = { bcv: '---', paralelo: '---', fecha: '' };

// ===== FUNCIONES DE BASE DE DATOS =====
async function db() {
    return await mysql.createConnection(dbConfig);
}

function limpiarCedula(texto) {
    return texto.replace(/\D/g, '');
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
        "SELECT id_cliente, nombres, usuario, clave FROM tab_clientes WHERE usuario=? LIMIT 1",
        [usuario]
    );
    await conn.end();
    return r[0] || null;
}

async function obtenerSaldo(id) {
    const conn = await db();
    const [r] = await conn.execute(
        "SELECT SUM(total - abono_factura) saldo FROM tab_facturas WHERE id_cliente=? AND pagada='NO'",
        [id]
    );
    await conn.end();
    return r[0].saldo || 0;
}

// ===== API DÓLAR =====
async function obtenerTasaDolar() {
    try {
        const response = await axios.get('https://pydolarvenezuela-api.vercel.app/api/v1/dollar');
        dolarInfo.bcv = response.data.monitors.bcv.price;
        dolarInfo.paralelo = response.data.monitors.enparalelovzla.price;
        dolarInfo.fecha = new Date().toLocaleString();
        console.log(`Dólar Actualizado: BCV ${dolarInfo.bcv} - Par ${dolarInfo.paralelo}`);
    } catch (e) {
        console.log("Error consultando API Dólar:", e.message);
    }
}

// ===== INICIO DEL BOT WHATSAPP =====
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
            qrcode.toDataURL(qr, { scale: 8 }, (err, url) => {
                qrCodeData = url;
            });
        }
        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("BOT CONECTADO Y LISTO");
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

        // 2. CONTROL HUMANO: Si yo envío un mensaje, el bot se desactiva para este cliente
        if (msg.key.fromMe) {
            await setModo(tel, 'humano');
            return;
        }

        // 3. VERIFICAR MODO (Bot o Humano)
        const sesion = await getSesion(tel);
        if (sesion && sesion.modo === 'humano') {
            console.log(`Mensaje de ${tel} ignorado (Modo Humano Activo)`);
            return;
        }

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        // COMANDO ESPECIAL: Dólar
        if (text.toLowerCase().includes("dolar") || text.toLowerCase().includes("tasa")) {
            await obtenerTasaDolar();
            await socketBot.sendMessage(from, { 
                text: `📊 *Tasas de Cambio Oficiales*\n\n💵 *BCV:* ${dolarInfo.bcv} Bs.\n📈 *Paralelo:* ${dolarInfo.paralelo} Bs.\n🕒 _${dolarInfo.fecha}_` 
            });
            return;
        }

        // FLUJO DE BIENVENIDA E IDENTIFICACIÓN
        if (!sesion) {
            await socketBot.sendMessage(from, { text: "👋 Bienvenido a *ONE4CARS* 🚗\n\nPor favor, envíe su número de RIF o Cédula para identificar su cuenta." });
            await setModo(tel, 'bot');
            return;
        }

        // MENÚ PRINCIPAL
        if (text.toLowerCase() === 'menu') {
            await socketBot.sendMessage(from, {
                text: "📋 *MENÚ PRINCIPAL:*\n\n1️⃣ Pagos\n2️⃣ Estado de cuenta (Saldo)\n3️⃣ Lista de Precios\n4️⃣ Pedidos\n5️⃣ Tasa del Dólar\n6️⃣ Registro\n\nEscriba el número o la palabra clave."
            });
            return;
        }

        // IDENTIFICAR CLIENTE POR RIF/CEDULA
        if (!sesion.usuario) {
            const cedula = limpiarCedula(text);
            if (cedula.length >= 6) {
                const cliente = await buscarCliente(cedula);
                if (cliente) {
                    await guardarUsuario(tel, cedula);
                    await socketBot.sendMessage(from, { text: `Hola *${cliente.nombres}* 👋\n\nCuenta vinculada con éxito. Ya puedes consultar tu *saldo*, pedir *precios* o hablar con nuestra IA.` });
                } else {
                    await socketBot.sendMessage(from, { text: "No encontramos ese RIF en nuestra base de datos. Por favor, verifique o escriba *soporte*." });
                }
                return;
            }
        }

        // CONSULTA DE SALDO
        if (text.toLowerCase().includes("saldo")) {
            const cliente = await buscarCliente(sesion.usuario);
            if (cliente) {
                const saldo = await obtenerSaldo(cliente.id_cliente);
                await socketBot.sendMessage(from, { text: `💰 *Estado de Cuenta*\n\nCliente: ${cliente.nombres}\nSaldo Pendiente: *$${saldo.toFixed(2)}*` });
            }
            return;
        }

        // IA GEMINI (PARA CUALQUIER OTRA CONSULTA)
        try {
            const instrucciones = fs.readFileSync('./instrucciones.txt', 'utf8');
            const chatIA = model.startChat({
                history: [{ role: "user", parts: [{ text: instrucciones }] }]
            });
            const result = await chatIA.sendMessage(text);
            await socketBot.sendMessage(from, { text: result.response.text() });
        } catch (error) {
            console.error("Error IA:", error);
            await socketBot.sendMessage(from, { text: "Lo siento, estoy teniendo dificultades técnicas. ¿Puedes intentar con la palabra *menu*?" });
        }
    });
}

// ===== SERVIDOR WEB PARA PANELES Y QR =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow">
        <div class="container">
            <a class="navbar-brand fw-bold" href="/">ONE4CARS ADMIN</a>
            <div class="navbar-text text-white small">Dólar BCV: ${dolarInfo.bcv} | Par: ${dolarInfo.paralelo}</div>
        </div>
    </nav>`;

    // PANEL COBRANZA
    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
            res.end(await cobranza.generarHTML(v, z, d, header, parsedUrl.query));
        } catch (e) { res.end(`Error: ${e.message}`); }

    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => { 
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); 
            res.end("OK"); 
        });

    } else if (parsedUrl.pathname === '/enviar-marketing' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', async () => {
            const data = JSON.parse(b);
            if (data.tipo === 'precios') await marketing.enviarListaPrecios(socketBot, data.clientes);
            if (data.tipo === 'promo') await marketing.enviarPromoPersonalizada(socketBot, data.clientes);
            res.end("OK");
        });

    } else {
        // PAGINA DE INICIO (QR Y STATUS)
        const refresh = qrCodeData.includes('data:image') ? '<meta http-equiv="refresh" content="10">' : '';
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(`
<html>
<head>
    ${refresh}
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <title>ONE4CARS BOT</title>
</head>
<body class="bg-light text-center">
    ${header}
    <div class="container py-5">
        <div class="card shadow p-4 mx-auto" style="max-width:480px;">
            <h4 class="mb-4">Status de Conexión</h4>
            <div class="mb-4">
                ${qrCodeData.startsWith('data') 
                    ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width:280px;">
                       <p class="mt-3 text-muted">Escanee el QR para activar el Bot</p>`
                    : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData}</div>`}
            </div>
            <div class="d-grid gap-2">
                <a href="/cobranza" class="btn btn-primary btn-lg fw-bold">PANEL DE COBRANZA</a>
                <button onclick="location.reload()" class="btn btn-outline-secondary">Actualizar Estado</button>
            </div>
            <hr>
            <p class="text-primary fw-bold small">Bot + IA Gemini + API Dólar Activo</p>
        </div>
    </div>
</body>
</html>`);
    }
});

// Manejo del error de puerto ocupado
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`Puerto ${PORT} ocupado, reintentando...`);
        setTimeout(() => {
            server.close();
            server.listen(PORT);
        }, 2000);
    }
});

// Arrancar Todo
server.listen(PORT, () => {
    console.log(`Servidor HTTP en puerto ${PORT}`);
    startBot();
    obtenerTasaDolar();
    setInterval(obtenerTasaDolar, 3600000); // Actualizar dólar cada 1 hora
});
