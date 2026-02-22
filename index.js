const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cron = require('node-cron');
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

// --- PROMPT PARA ONE4CARS ---
const SYSTEM_PROMPT = `Eres el asistente de ONE4CARS (Importadora en Venezuela). 
Tu misión es: 
1. Si el cliente dice una fecha/día de pago, responde: "Entendido, lo agendo para seguimiento".
2. Si preguntan precios, indica que consulten en: https://www.one4cars.com/consulta_productos.php/
3. Sé profesional y usa un tono de apoyo al vendedor.`;

// --- TAREA DE COBRANZA (9 AM) ---
cron.schedule('0 9 * * *', async () => {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute("SELECT celular, nombres, nro_factura FROM tab_facturas WHERE pagada = 'NO' AND DATEDIFF(CURDATE(), fecha_reg) = 32");
        for (let f of rows) {
            enviarMensaje(f.celular, `Hola *${f.nombres}*, le recordamos su factura #${f.nro_factura} pendiente en ONE4CARS. ¿Podemos ayudarle con algo?`);
        }
    } catch (e) { console.error(e); } finally { if(conn) await conn.end(); }
});

async function enviarMensaje(numero, texto) {
    if (!socketBot) return;
    let num = numero.toString().replace(/\D/g, '');
    if (!num.startsWith('58')) num = '58' + num;
    await socketBot.sendMessage(`${num}@s.whatsapp.net`, { text: texto });
}

// --- WHATSAPP LOGIC ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    socketBot = makeWASocket({ auth: state, logger: pino({ level: 'error' }) });
    socketBot.ev.on('creds.update', saveCreds);
    socketBot.ev.on('connection.update', (u) => { 
        if (u.qr) qrcode.toDataURL(u.qr, (err, url) => qrCodeData = url);
        if (u.connection === 'open') qrCodeData = "ONLINE";
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(`${SYSTEM_PROMPT}\nUsuario: ${body}`);
            const resp = result.response.text();
            await socketBot.sendMessage(from, { text: resp });

            if (resp.toLowerCase().includes("agendo")) {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente) SELECT id_cliente, 'COMPROMISO', ? FROM tab_clientes WHERE celular LIKE ?", [body, `%${from.split('@')[0].slice(-10)}%`]);
                await conn.end();
            }
        } catch (e) { console.error(e); }
    });
}

// --- SERVIDOR WEB ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    if (parsedUrl.pathname === '/cobranza') {
        const data = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let html = `<html><head><style>table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ddd;padding:8px;} th{background:#f4f4f4;}</style></head><body>`;
        html += `<h2>Panel de Cobranza ONE4CARS</h2>`;
        html += `<form>Días: <input name="dias" value="${parsedUrl.query.dias || 0}"> <button>Filtrar</button></form>`;
        html += `<table><tr><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr>`;
        data.forEach(r => {
            html += `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>${r.saldo_pendiente}</td><td>${r.dias_transcurridos}</td></tr>`;
        });
        html += `</table></body></html>`;
        res.end(html);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h1>ONE4CARS BOT</h1>${qrCodeData === "ONLINE" ? "✅ Conectado" : `<img src="${qrCodeData}">`}`);
    }
}).listen(port);

startBot();
