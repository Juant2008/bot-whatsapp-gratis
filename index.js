const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
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

// --- ENTRENAMIENTO COMPLETO Y DETALLADO (RESTAURADO) ---
const SYSTEM_PROMPT = `Eres Gemini, el asistente oficial de ONE4CARS. 
MODELO DE NEGOCIO: Empresa importadora de autopartes desde China hacia Venezuela.
ESTRUCTURA FÍSICA: 
- Almacén General: Se guardan los bultos cerrados de mercancía.
- Almacén Intermedio: Se abren bultos y se mantiene el stock para despacho inmediato.
ESTRUCTURA DE DATOS (SQL):
- Clientes: tab_clientes | Vendedores: tab_vendedores (10 vendedores aprox).
- Facturación: tab_facturas (cabecera: nro_factura, monto, estatus pagada SI/NO) y tab_facturas_reng (detalles).
- Web Remota: Maneja tab_pedidos y tab_pagos.
- Compras: tab_proveedores_facturas y tab_cotizaciones (China).
REGLAS DE RESPUESTA:
1. CONSULTA PRODUCTOS: https://www.one4cars.com/consulta_productos.php/
2. OBJECIÓN DÓLAR: Explica que somos importadores directos, precios en divisas protegen la reposición de stock.
3. COBRANZA: Si el cliente da fecha de pago o promete abonar, responde: "Entendido, lo agendo para seguimiento".
4. ESTATUS: Si preguntan por facturas, decir que el asesor de zona validará el estatus en tab_facturas.`;

// --- LÓGICA DEL BOT ---
async function startBot() {
    // La carpeta 'auth_info' guarda la sesión. 
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    socketBot = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });
    
    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        
        if (qr) {
            botStatus = "LISTO PARA ESCANEAR";
            qrCodeData = await qrcode.toDataURL(qr);
        }

        if (connection === 'open') {
            botStatus = "CONECTADO";
            qrCodeData = "ONLINE";
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            botStatus = "RECONECTANDO...";
            
            // Si la sesión es inválida, forzamos reinicio total
            if (statusCode === DisconnectReason.loggedOut) {
                botStatus = "SESIÓN CERRADA - ESCANEE DE NUEVO";
            } else {
                setTimeout(startBot, 5000); // Reintento en 5 seg
            }
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

            // REGISTRO AUTOMÁTICO DE COMPROMISOS
            if (resp.toLowerCase().includes("agendo") || body.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|pago el|pagaré)\b/)) {
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
            let rows = data.map(r => `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td><td>$${parseFloat(r.saldo_pendiente || 0).toFixed(2)}</td><td>${r.dias_transcurridos}</td></tr>`).join('');
            res.end(`<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="container p-4"><h2>Gestión de Cobranza ONE4CARS</h2><table class="table table-dark table-striped"><thead><tr><th>Cliente</th><th>Factura</th><th>Saldo</th><th>Días</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
        } catch (e) { res.end("Error conectando a tab_facturas: " + e.message); }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        let visual = "";
        if (qrCodeData === "ONLINE") {
            visual = "<h1 style='color:green'>✅ BOT ONE4CARS EN LÍNEA</h1><br><a href='/cobranza' class='btn btn-primary'>Ver Deudores</a>";
        } else if (qrCodeData) {
            visual = `<h1>ONE4CARS AI</h1><p>Escanea el código para activar el sistema:</p><img src="${qrCodeData}" width="350" style="border: 15px solid white; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.2);">`;
        } else {
            visual = `<h1>ONE4CARS AI</h1><div class="spinner-border text-primary"></div><p>Estado: <b>${botStatus}</b></p><p>Si tarda mucho, refresque la página.</p>`;
        }
        res.end(`<html><head><meta http-equiv="refresh" content="10"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"></head><body class="text-center mt-5">${visual}</body></html>`);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor ONE4CARS desplegado en puerto ${port}`);
    startBot();
});
