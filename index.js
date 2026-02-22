const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const mysql = require('mysql2/promise');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN ---
const genAI = new GoogleGenerativeAI("TU_API_KEY_AQUI"); 
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let socketBot = null;
let qrCodeData = "";
const port = process.env.PORT || 10000;

// --- ENTRENAMIENTO COMPLETO ONE4CARS ---
const SYSTEM_PROMPT = `Eres Gemini, asistente de ONE4CARS (Importadora China-Venezuela).
- Almacenes: General (bultos) e Intermedio (stock). 10 vendedores.
- SQL: tab_cliente, tab_vendedores, tab_facturas (pagada SI/NO), tab_facturas_reng, tab_productos.
- Compras China: tab_cotizaciones, tab_proveedores_facturas.
- Regla 1: Precios/Stock enviar siempre https://www.one4cars.com/consulta_productos.php/
- Regla 2: Si prometen pago, di: "Entendido, lo agendo para seguimiento".
- Regla 3: Precios en divisas por reposición de stock (importadores directos).`;

async function startBot() {
    // Usamos una carpeta temporal para evitar bloqueos de permisos en Render
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_one4cars');
    
    socketBot = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        printQRInTerminal: false 
    });
    
    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
            console.log("QR GENERADO - LISTO");
        }
        if (connection === 'open') {
            qrCodeData = "ONLINE";
            console.log("CONECTADO");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();
        const numLimpio = from.split('@')[0].slice(-10);

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(`${SYSTEM_PROMPT}\nUsuario: ${body}`);
            const resp = result.response.text();
            await socketBot.sendMessage(from, { text: resp });

            if (resp.toLowerCase().includes("agendo") || body.match(/\b(lunes|martes|miercoles|jueves|viernes|pago|abon)\b/)) {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente, comentario_bot) SELECT id_cliente, 'COMPROMISO', ?, ? FROM tab_clientes WHERE celular LIKE ?", [body, resp, `%${numLimpio}%`]);
                await conn.end();
            }
        } catch (e) { console.error("Error:", e); }
    });
}

// --- SERVIDOR WEB ---
http.createServer(async (req, res) => {
    if (req.url === '/cobranza') {
        try {
            const data = await cobranza.obtenerListaDeudores();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            let rows = data.map(r => `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>${r.monto}</td></tr>`).join('');
            res.end(`<h2>Cobranza ONE4CARS</h2><table border="1"><thead><tr><th>Cliente</th><th>Factura</th><th>Monto</th></tr></thead><tbody>${rows}</tbody></table>`);
        } catch (e) { res.end("Error DB"); }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData === "ONLINE") {
            res.end("<center><h1>✅ SISTEMA CONECTADO</h1></center>");
        } else if (qrCodeData) {
            res.end(`<center><h1>ONE4CARS AI</h1><p>Escanea el QR:</p><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.end("<center><h1>ONE4CARS AI</h1><p>Generando acceso... Por favor espera 15 segundos y refresca.</p></center>");
        }
    }
}).listen(port, '0.0.0.0', () => {
    startBot();
});
