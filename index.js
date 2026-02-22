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

// --- ENTRENAMIENTO COMPLETO ONE4CARS (RESTAURADO AL 100%) ---
const SYSTEM_PROMPT = `Actúa como Gemini, el asistente inteligente de ONE4CARS.
EMPRESA: Importadora de autopartes desde China hacia Venezuela.
LOGÍSTICA:
- Almacén General: Donde se guardan los bultos cerrados de mercancía recibidos de China.
- Almacén Intermedio: Donde se abren bultos y se mantiene stock para despachar pedidos.
- Vendedores: Contamos con 10 vendedores activos.
BASE DE DATOS (MySQL):
- Clientes: tab_cliente | Vendedores: tab_vendedores.
- Facturación: tab_facturas (nro_factura, id_cliente, id_vendedor, nombres, monto, pagada SI/NO, comision_pagada SI/NO).
- Detalles: tab_facturas_reng (relacionada con tab_productos por id_producto).
- Web Remota: tab_pedidos y tab_pagos (reportes de clientes/vendedores).
- Compras China: tab_cotizaciones, tab_cotizaciones_reng, tab_proveedores_facturas y tab_proveedores_facturas_reng.
- Correlativos: tab_correlativos.
REGLAS DE ORO:
1. CONSULTA PRODUCTOS: Envía siempre https://www.one4cars.com/consulta_productos.php/ para precios y stock.
2. DÓLAR/PRECIO: Si dicen que es caro, explica que somos importadores directos; los precios en divisas garantizan la reposición de stock.
3. COBRANZA: Si el cliente da una fecha de pago, responde: "Entendido, lo agendo para seguimiento".
4. INVENTARIO: No inventes stock, remite siempre a la web de consulta.`;

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
        if (qr) qrCodeData = await qrcode.toDataURL(qr);
        if (connection === 'open') qrCodeData = "ONLINE";
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

            // Registro automático de compromisos en SQL
            if (resp.toLowerCase().includes("agendo") || body.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|pago el|pagare)\b/)) {
                const conn = await mysql.createConnection(dbConfig);
                await conn.execute("INSERT INTO tab_agenda_seguimiento (id_cliente, tipo_evento, respuesta_cliente, comentario_bot) SELECT id_cliente, 'COMPROMISO', ?, ? FROM tab_clientes WHERE celular LIKE ?", [body, resp, `%${numLimpio}%`]);
                await conn.end();
            }
        } catch (e) { console.error("Error:", e); }
    });
}

// --- SERVIDOR WEB ---
http.createServer(async (req, res) => {
    const urlParts = req.url.split('?');
    const path = urlParts[0];

    if (path === '/cobranza') {
        try {
            const data = await cobranza.obtenerListaDeudores();
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            let filas = data.map(r => `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>${r.monto}</td><td>${r.pagada}</td></tr>`).join('');
            res.end(`<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="p-4"><h2>Cobranza ONE4CARS</h2><table class="table table-striped"><thead><tr><th>Cliente</th><th>Factura</th><th>Monto</th><th>Pagada</th></tr></thead><tbody>${filas}</tbody></table></body></html>`);
        } catch (e) { res.end("Error al consultar tab_facturas"); }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let html = "";
        if (qrCodeData === "ONLINE") {
            html = "<h1 style='color:green'>✅ ONE4CARS CONECTADO</h1><br><a href='/cobranza'>Ver Cobranza</a>";
        } else if (qrCodeData) {
            html = `<h1>ONE4CARS AI</h1><p>Escanea el código para activar:</p><img src="${qrCodeData}" width="300">`;
        } else {
            html = "<h1>ONE4CARS AI</h1><p>Iniciando sistema... Refresca en unos segundos.</p>";
        }
        res.end(`<center style="margin-top:50px">${html}</center>`);
    }
}).listen(port, '0.0.0.0', () => {
    startBot();
});
