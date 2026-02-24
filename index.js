const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const mysql = require('mysql2/promise');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (API KEY DESDE RENDER) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- CONFIGURACIÓN DE BASE DE DATOS ---
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

// --- ENTRENAMIENTO COMPLETO EXTRAÍDO DEL DOCUMENTO ---
const SYSTEM_PROMPT = `
Eres el Asistente Virtual de lenguaje natural de ONE4CARS. Tu misión es atender a clientes y vendedores como un experto.
INSTRUCCIONES DE ENTRENAMIENTO OBLIGATORIAS:

1. SOBRE LA EMPRESA:
- Somos importadores directos de autopartes desde China en Venezuela.
- Tenemos dos almacenes: 
  * Almacén General: Donde se guardan los bultos de mercancía (venta al mayor).
  * Almacén Intermedio: Donde se abren bultos y se mantiene stock para despachos rápidos.
- Contamos con 10 vendedores que cubren Caracas y el interior del país.
- Despachos: En Caracas entrega propia. Al interior, por la encomienda que el cliente prefiera (MRW, Zoom, Tealca, etc.).

2. PRODUCTOS (Entrenamiento de Stock):
Debes conocer y ofrecer nuestros productos estrella: Bombas de Gasolina, Bujías de Encendido, Correas, Crucetas, Filtros de Aceite, Filtros de Gasolina, Lápiz Estabilizador, Muñones, Poleas, Puentes de Cardan, Puntas de Tripoide, Rodamientos de Rueda, Sensores, Bases de Motor, Amortiguadores, Pastillas de Freno, Kit de Tiempo, Estoperas, y toda la línea de suspensión. 
Venta: Al mayor (mínimo $100) y al detal.

3. ESTRUCTURA TÉCNICA (Base de Datos):
- Clientes: 'tab_cliente'. Vendedores: 'tab_vendedores'.
- Facturas: 'tab_facturas' (cabecera con nro_factura, id_cliente, monto, pagada [SI/NO], comision_pagada [SI/NO]).
- Renglones: 'tab_facturas_reng' (se relaciona con la factura mediante id_factura).
- Web: Los pedidos de la web van a 'tab_pedidos' y los pagos a 'tab_pagos'.
- China: Cotizaciones en 'tab_cotizaciones' y compras en 'tab_proveedores_facturas'.
- Correlativos: Se guardan en 'tab_correlativos'.

4. ENLACES Y SERVICIOS (Responder según necesidad):
- 🏦 Medios de Pago: https://www.one4cars.com/medios_de_pago.php/
- 📄 Estado de Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
- 💰 Lista de Precios/Productos: https://www.one4cars.com/consulta_productos.php/
- 🛒 Tomar Pedido: https://www.one4cars.com/tomar_pedido.php/
- 👥 Afiliar Cliente: https://www.one4cars.com/afiliar_cliente.php/
- 👥 Mis Clientes: https://www.one4cars.com/mis_clientes.php/
- ⚙️ Ficha Producto: https://www.one4cars.com/ficha_producto.php/
- 🚚 Despacho: https://www.one4cars.com/despacho.php/
- 👤 Asesor: Contacto directo con ventas.

5. REGLAS DE ORO:
- COBRANZA: Si un cliente tiene facturas con pagada='NO' y más de 35 días, recuérdale amablemente su compromiso de pago.
- PRIVACIDAD: Solicita RIF o Cédula antes de dar saldos.
- TONO: Profesional, venezolano, servicial. Usa "Estimado cliente" y "Estamos a su orden".
- IMPORTANTE: No inventes precios ni stock. Si no sabes algo, indica que consultarás con el almacén.
`;

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("Reconectando...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const userText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        try {
            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
                    { role: "model", parts: [{ text: "Entendido. Soy el asistente de ONE4CARS entrenado. ¿En qué puedo ayudarle?" }] }
                ],
            });

            const result = await chat.sendMessage(userText);
            const response = result.response.text();
            await sock.sendMessage(from, { text: response });
        } catch (error) {
            console.error("Error Gemini:", error.message);
        }
    });
}

// --- SERVIDOR HTTP CON TODAS LAS RUTAS ORIGINALES ---
http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // RUTA POST PARA MENSAJES EXTERNOS
    if (req.method === 'POST' && parsedUrl.pathname === '/enviar-mensaje') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (socketBot && data.telefono && data.mensaje) {
                    let num = data.telefono.replace(/\D/g, '');
                    if (!num.startsWith('58')) num = '58' + num;
                    await socketBot.sendMessage(`${num}@s.whatsapp.net`, { text: data.mensaje });
                    res.writeHead(200); res.end('OK');
                } else {
                    res.writeHead(400); res.end('Faltan datos');
                }
            } catch(e) { res.writeHead(500); res.end('Error'); }
        });
        return;
    }

    // RUTA DE COBRANZA
    if (parsedUrl.pathname === '/cobranza') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write("<center><h1>Módulo de Cobranza ONE4CARS</h1><p>Estado: Activo</p></center>");
        res.end();
        return;
    }

    // VISTA PRINCIPAL CON HEADER
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(`
        <html>
        <head><title>ONE4CARS AI</title></head>
        <body style="margin:0; font-family:Arial;">
            <header style="background:#000; color:#fff; padding:20px; text-align:center;">
                <h1>ONE4CARS - CONTROL DE INTELIGENCIA ARTIFICIAL</h1>
            </header>
            <div style="text-align:center; padding:50px;">
    `);

    if (qrCodeData.includes("data:image")) {
        res.write(`<h2>Escanea para conectar</h2><img src="${qrCodeData}" width="300">`);
    } else {
        res.write(`<h2>Status: ${qrCodeData || "Iniciando..."}</h2>`);
    }

    res.write(`
            </div>
            <footer style="text-align:center; padding:20px; background:#eee; position:fixed; bottom:0; width:100%;">
                <a href="/cobranza">Cobranza</a> | <a href="https://www.one4cars.com">Web</a>
            </footer>
        </body>
        </html>
    `);
    res.end();
}).listen(port);

// --- CRONJOBS ORIGINALES ---
cron.schedule('0 9 * * 1-5', async () => {
    if (socketBot) {
        console.log('Ejecutando cobros...');
        // Aquí llamas a tu módulo de cobranza si es necesario
    }
});

startBot();
