const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
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
let botStatus = "INICIALIZANDO...";
const port = process.env.PORT || 10000;

// --- ENTRENAMIENTO COMPLETO ONE4CARS ---
const SYSTEM_PROMPT = `Eres el asistente experto de ONE4CARS. 
EMPRESA: Importadora de autopartes desde China para Venezuela. 
ALMACENES: General (bultos) e Intermedio (stock detallado).

REGLAS DE NEGOCIO Y LINKS:
1. Consulta de Productos: Siempre que pregunten precios o existencias, envía este link: https://www.one4cars.com/consulta_productos.php/
2. Pagos: Si preguntan dónde pagar o reportar, usa la web oficial.
3. Dólar/Precios: Si dicen que está caro, explica que somos importadores directos y protegemos su inversión con precios competitivos en divisas.
4. Cobranza: Si el cliente da una fecha de pago, responde: "Entendido, lo agendo para seguimiento".
5. Atención: Sé profesional, usa "Estimado" o "Amigo".`;

// --- LÓGICA DEL BOT ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    socketBot = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });
    
    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
            botStatus = "ESPERANDO ESCANEO";
            qrCodeData = await qrcode.toDataURL(qr);
        }
        if (connection === 'open') {
            botStatus = "CONECTADO";
            qrCodeData = "ONLINE";
        }
        if (connection === 'close') {
            botStatus = "RECONECTANDO";
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

            // Registro en tab_agenda_seguimiento
            if (resp.toLowerCase().includes("agendo") || body.match(/\b(lunes|martes|miercoles|jueves|viernes|pago el)\b/)) {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente, comentario_bot) SELECT id_cliente, 'COMPROMISO', ?, ? FROM tab_clientes WHERE celular LIKE ?", [body, resp, `%${numLimpio}%`]);
                await conn.end();
            }
        } catch (e) { console.error("Error IA:", e); }
    });
}

// --- SERVIDOR WEB ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    if (path === '/cobranza') {
        try {
            const data = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            let rows = data.map(r => `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>$${parseFloat(r.saldo_pendiente || 0).toFixed(2)}</td></tr>`).join('');
            res.end(`<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="p-4"><h2>Lista de Cobranza</h2><table class="table table-striped"><thead><tr><th>Cliente</th><th>Factura</th><th>Saldo</th></tr></thead><tbody>${rows}</tbody></table><br><a href="/" class="btn btn-secondary">Volver al Inicio</a></body></html>`);
        } catch (e) { res.end("Error de conexión a la base de datos."); }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let htmlContent = "";
        
        if (qrCodeData === "ONLINE") {
            htmlContent = "<h1 style='color:green'>✅ SISTEMA CONECTADO</h1><p>ONE4CARS AI está activo.</p><br><a href='/cobranza' style='padding:10px; background:blue; color:white; text-decoration:none; border-radius:5px;'>Ver Panel de Cobranza</a>";
        } else if (qrCodeData) {
            htmlContent = `<h1>ONE4CARS AI</h1><p>Escanea este código para activar el bot:</p><img src="${qrCodeData}" width="300"><br><p>Estado: <b>${botStatus}</b></p>`;
        } else {
            htmlContent = `<h1>ONE4CARS AI</h1><p>Iniciando conexión con WhatsApp...</p><p>Estado: <b>${botStatus}</b></p><p>La página se refrescará sola cada 10 segundos.</p>`;
        }
        
        res.end(`<html><head><meta http-equiv="refresh" content="10"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="text-center p-5">${htmlContent}</body></html>`);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor ONE4CARS en puerto ${port}`);
    startBot();
});
