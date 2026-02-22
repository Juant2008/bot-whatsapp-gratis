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
const genAI = new GoogleGenerativeAI("TU_API_KEY_AQUI"); // <--- PON TU KEY AQUÍ
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let socketBot = null;
let qrCodeData = "";
const port = process.env.PORT || 10000;

// --- PROMPT ---
const SYSTEM_PROMPT = `Eres el asistente experto de ONE4CARS.
EMPRESA: Importadora de autopartes China para Venezuela.
MANEJO DE OBJECIONES:
1. "Dólar caro": Somos importadores directos, precios competitivos en divisas.
2. "No tengo dinero": Empatía y pedir fecha estimada de abono.
3. "Falla": Pedir fotos y remitir a asesor de zona.
REGLAS: Si prometen fecha de pago, di "Entendido, lo agendo para seguimiento".`;

// --- FUNCIONES DB ---
async function consultarSaldoCliente(celular) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [rows] = await conn.execute("SELECT (total - abono_factura) as saldo, nro_factura FROM tab_facturas WHERE celular LIKE ? AND pagada = 'NO'", [`%${celular}%`]);
        return rows;
    } finally { await conn.end(); }
}

async function consultarStock(busqueda) {
    const conn = await mysql.createConnection(dbConfig);
    try {
        const [rows] = await conn.execute("SELECT producto, descripcion, cantidad_existencia FROM tab_productos WHERE producto LIKE ? OR descripcion LIKE ? LIMIT 3", [`%${busqueda}%`, `%${busqueda}%`]);
        return rows;
    } finally { await conn.end(); }
}

// --- COBRANZA AUTOMÁTICA ---
cron.schedule('0 9 * * *', async () => {
    try {
        const conn = await mysql.createConnection(dbConfig);
        const [deudores] = await conn.execute("SELECT celular, nombres, nro_factura, (total - abono_factura) as saldo FROM tab_facturas WHERE pagada = 'NO' AND DATEDIFF(CURDATE(), fecha_reg) = 32");
        for (let d of deudores) {
            enviarMensaje(d.celular, `Hola *${d.nombres}*, recordamos su saldo de $${d.saldo} en factura #${d.nro_factura}. ¿Podemos agendar su pago?`);
        }
        await conn.end();
    } catch (e) { console.error("Error Cron:", e); }
});

async function enviarMensaje(numero, texto) {
    if (!socketBot) return;
    let num = numero.toString().replace(/\D/g, '');
    if (!num.startsWith('58')) num = '58' + num;
    await socketBot.sendMessage(`${num}@s.whatsapp.net`, { text: texto });
}

// --- WHATSAPP START ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    socketBot = makeWASocket({ auth: state, logger: pino({ level: 'error' }) });
    
    socketBot.ev.on('creds.update', saveCreds);
    socketBot.ev.on('connection.update', (u) => {
        if (u.qr) qrcode.toDataURL(u.qr, (err, url) => { qrCodeData = url; });
        if (u.connection === 'open') qrCodeData = "ONLINE";
    });

    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();
        const numLimpio = from.split('@')[0].slice(-10);

        try {
            let contextoExtra = "";
            if (body.includes("saldo") || body.includes("debo")) {
                const saldos = await consultarSaldoCliente(numLimpio);
                contextoExtra = `Saldos: ${JSON.stringify(saldos)}`;
            }
            if (body.includes("tienes") || body.includes("precio")) {
                const stock = await consultarStock(body.replace("tienes", "").trim());
                contextoExtra = `Stock: ${JSON.stringify(stock)}`;
            }

            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(`${SYSTEM_PROMPT}\n${contextoExtra}\nUsuario: ${body}`);
            const resp = result.response.text();
            await socketBot.sendMessage(from, { text: resp });

            if (resp.toLowerCase().includes("agendo") || body.match(/\b(lunes|martes|miercoles|jueves|viernes|pago el)\b/)) {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente, comentario_bot) SELECT id_cliente, 'COMPROMISO', ?, ? FROM tab_clientes WHERE celular LIKE ?", [body, resp, `%${numLimpio}%`]);
                await conn.end();
            }
        } catch (e) { console.error("AI Error:", e); }
    });
}

// --- SERVIDOR WEB ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/cobranza') {
        const data = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let html = `<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="p-4">`;
        html += `<h3>Cobranza ONE4CARS</h3><table class="table table-sm"><thead><tr><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr></thead><tbody>`;
        data.forEach(r => {
            html += `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>${parseFloat(r.saldo_pendiente).toFixed(2)}</td><td>${r.dias_transcurridos}</td></tr>`;
        });
        html += `</tbody></table></body></html>`;
        res.end(html);
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<center><h1>ONE4CARS AI</h1>${qrCodeData === "ONLINE" ? "✅ CONECTADO" : `<img src="${qrCodeData}"><p>Escanee el QR</p>`}</center>`);
    }
});

server.listen(port, () => {
    console.log(`Servidor en puerto ${port}`);
    startBot();
});
