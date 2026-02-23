const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE GEMINI (Resolución de Error 404) ---
// Se utiliza gemini-2.0-flash basándose en la disponibilidad de modelos de 2026
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelIA = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash", 
    systemInstruction: `Eres el Asistente Virtual Inteligente de ONE4CARS.
    Misión: Vendedor experto y gestor de cobranza para importadora de autopartes en Venezuela.
    
    MENÚ DE NAVEGACIÓN OBLIGATORIO:
    Siempre que sea pertinente, ofrece estas opciones exactas:
    🏦 Medios de Pago: https://www.one4cars.com/medios_de_pago.php/
    📄 Estado de Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
    💰 Lista de Precios: https://www.one4cars.com/consulta_productos.php/
    🛒 Tomar Pedido: https://www.one4cars.com/tomar_pedido.php/
    👥 Afiliar Cliente: https://www.one4cars.com/afiliar_clientes.php/
    👥 Mis Clientes: https://www.one4cars.com/mis_clientes.php/ (Solo Vendedores)
    ⚙️ Ficha Producto: https://www.one4cars.com/consulta_productos.php/
    🚚 Despacho: https://one4cars.com/sevencorpweb/productos_transito_web.php
    👤 Asesor: Indica que un asesor humano lo contactará.

    REGLAS DE NEGOCIO:
    - Empresa: ONE4CARS. Importadora desde China. Almacén en Caracas.
    - Descuento Divisas: 40% (Efectivo/Zelle). Tasa: BCV del día.
    - Si mencionan fechas de pago (ej. "pago el lunes"), confirma el registro en agenda.`
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

async function startBot() {
    // Manejo de estado de autenticación
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS AI", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS AI Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const titulo = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";

        try {
            // Efecto de escritura para naturalidad
            await sock.sendPresenceUpdate('composing', from);

            // Generar respuesta con el modelo 2.0 (Solución al error 404)
            const result = await modelIA.generateContent(body);
            const responseText = result.response.text();

            await sock.sendMessage(from, { text: titulo + responseText });
        } catch (error) {
            console.error("Error Gemini:", error.message);
            // Respuesta de respaldo en caso de error de API
            await sock.sendMessage(from, { 
                text: titulo + "Hola! Mi sistema está procesando una actualización de inventario. ¿En qué puedo ayudarte? Si necesitas atención urgente escribe *Asesor*." 
            });
        }
    });
}

// --- SERVIDOR HTTP INTEGRADO (Cobranza y QR) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`
            <html>
            <head>
                <title>ONE4CARS - Panel de Cobranza</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>body{background:#f8f9fa} .container{margin-top:20px; background:white; padding:20px; border-radius:10px; box-shadow:0 0 10px rgba(0,0,0,0.1)}</style>
            </head>
            <body>
                <div class="container">
                    <h2>📊 Panel de Cobranza ONE4CARS</h2>
                    <hr>
                    <form method="GET" class="row g-2 mb-4">
                        <div class="col-md-4">
                            <select name="vendedor" class="form-select">
                                <option value="">Vendedor: Todos</option>
                                ${vendedores.map(v => `<option value="${v.nombre}">${v.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-md-4">
                            <button type="submit" class="btn btn-primary w-100">Filtrar</button>
                        </div>
                    </form>
                    <div class="table-responsive">
                        <table class="table table-hover">
                            <thead><tr><th>Cliente</th><th>Factura</th><th>Saldo</th><th>Días</th></tr></thead>
                            <tbody>
                                ${deudores.map(d => `
                                    <tr>
                                        <td>${d.nombres}</td>
                                        <td>${d.nro_factura}</td>
                                        <td class="text-danger">$${parseFloat(d.saldo_pendiente).toFixed(2)}</td>
                                        <td>${d.dias_transcurridos}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </body>
            </html>
        `);
        res.end();
    } 
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) {
                cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                res.writeHead(200); res.end('Envío iniciado');
            } else {
                res.writeHead(400); res.end('Error: Bot no conectado');
            }
        });
    }
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:50px;"><h1>Escanea ONE4CARS AI</h1><img src="${qrCodeData}" width="300"><br><br><a href="/cobranza">Ir a Cobranza</a></center>`);
        } else {
            res.write(`<center style="margin-top:100px;"><h1>${qrCodeData || "Iniciando..."}</h1><br><a href="/cobranza" style="padding:10px; background:green; color:white;">ENTRAR A COBRANZA</a></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
