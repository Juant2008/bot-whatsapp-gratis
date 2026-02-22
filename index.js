const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mysql = require('mysql2/promise');
const cobranza = require('./cobranza');

// --- CONFIG ---
const genAI = new GoogleGenerativeAI("TU_API_KEY_AQUI");
let socketBot = null;
let qrCodeData = "";
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// --- ENTRENAMIENTO DE GEMINI (ADAPTADO A TUS TABLAS) ---
const SYSTEM_PROMPT = `Eres el asistente de ONE4CARS. 
Tu labor es:
1. Gestionar cobranza amable (tab_facturas: pagada='NO').
2. Registrar compromisos: Si el cliente dice una fecha de pago, responde confirmando y di que lo anotarás.
3. Vendedores: Si te escribe un vendedor (tab_vendedores), ayúdalo con su zona.
4. Links: 
   - Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/
   - Pagos: https://www.one4cars.com/medios_de_pago.php/
   - Productos: https://www.one4cars.com/consulta_productos.php/
Regla: No inventes precios. Si preguntan stock, usa la información de tab_productos (almacen intermedio/general).`;

// --- TAREAS AUTOMÁTICAS (CRON) ---
cron.schedule('0 9 * * *', async () => { // Todos los días a las 9 AM
    const conn = await mysql.createConnection(dbConfig);
    try {
        // A. SATISFACCIÓN (15-20 días)
        const [satisfaccion] = await conn.execute(`
            SELECT f.celular, f.nombres, f.nro_factura 
            FROM tab_facturas f
            WHERE f.pagada = 'NO' AND DATEDIFF(CURDATE(), f.fecha_reg) BETWEEN 15 AND 20
        `);
        for (let cli of satisfaccion) {
            enviarWS(cli.celular, `Hola *${cli.nombres}*, de ONE4CARS. Hace unos días recibió su pedido #${cli.nro_factura}. ¿Todo llegó bien? ¿Está satisfecho con sus productos?`);
            await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, nro_factura, tipo_evento, comentario_bot) VALUES ((SELECT id_cliente FROM tab_facturas WHERE nro_factura=?), ?, 'SATISFACCION', 'Enviada consulta de satisfacción')", [cli.nro_factura, cli.nro_factura]);
        }

        // B. COBRANZA Y RECORDATORIO AL VENDEDOR (Vencimiento > 30 días)
        const [vencidas] = await conn.execute(`
            SELECT celular, nombres, nro_factura, vendedor, celular_vendedor 
            FROM tab_facturas WHERE pagada = 'NO' AND DATEDIFF(CURDATE(), fecha_reg) >= 30
        `);
        for (let v of vencidas) {
            // Al cliente
            enviarWS(v.celular, `Estimado *${v.nombres}*, le recordamos que su factura #${v.nro_factura} ha vencido. Agradecemos concretar su pago para mantener su crédito activo.`);
            // Al vendedor
            enviarWS(v.celular_vendedor, `⚠️ *ALERTA COBRANZA*: El cliente ${v.nombres} tiene la factura #${v.nro_factura} vencida. Por favor hacer seguimiento.`);
        }
    } catch (e) { console.error(e); } finally { await conn.end(); }
});

// --- FUNCIÓN PARA ENVIAR WHATSAPP ---
async function enviarWS(numero, texto) {
    if (!socketBot) return;
    let num = numero.toString().replace(/\D/g, '');
    if (!num.startsWith('58')) num = '58' + num;
    await socketBot.sendMessage(`${num}@s.whatsapp.net`, { text: texto });
}

// --- LOGICA DE MENSAJES ENTRANTE ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({ auth: state, logger: pino({ level: 'error' }) });
    socketBot = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => { if (u.qr) qrcode.toDataURL(u.qr, (err, url) => qrCodeData = url); });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();

        // Gemini procesa el mensaje
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`${SYSTEM_PROMPT}\nCliente dice: ${body}`);
        const respuestaIA = result.response.text();

        await sock.sendMessage(from, { text: respuestaIA });

        // LÓGICA DE DETECCIÓN DE COMPROMISOS (Si la IA confirma un compromiso)
        if (respuestaIA.toLowerCase().includes("agendado") || respuestaIA.toLowerCase().includes("anotado")) {
            const conn = await mysql.createConnection(dbConfig);
            // Guardamos en la tabla de seguimiento que hubo un compromiso
            await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente, estatus) SELECT id_cliente, 'COMPROMISO', ?, 'PENDIENTE' FROM tab_cliente WHERE celular LIKE ?", [body, `%${from.split('@')[0].substring(2)}%`]);
            await conn.end();
        }
    });
}

// --- SERVIDOR HTTP ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/cobranza') {
        // Aquí pones tu código de la tabla HTML de cobranza que ya tienes
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h1>ONE4CARS BOT</h1><img src="${qrCodeData}">`);
    }
}).listen(port);

startBot();
