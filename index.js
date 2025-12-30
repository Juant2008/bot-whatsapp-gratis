const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

// ========================================================
// 1. CONFIGURACIÓN MONGODB
const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
// ========================================================

let qrCodeData = "";

// Conexión a MongoDB para monitoreo de estado
mongoose.connect(mongoURI)
    .then(() => console.log("✅ Memoria permanente MongoDB conectada"))
    .catch(err => console.error("❌ Error MongoDB:", err.message));

async function startBot() {
    // Carpeta 'auth_info' para persistencia local en Render (mientras no se reinicie)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"],
        syncFullHistory: false, // Vital para no colapsar la RAM
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us'), // Ignora estados y grupos
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeData = url; 
                console.log("✅ Nuevo QR listo para escanear");
            });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("🔄 Conexión perdida, reintentando...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS EN LÍNEA');
        }
    });

    // --- LÓGICA DE MENSAJES ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoFormal = 'Saludos estimado, ingrese al siguiente link para obtener ';

        // RESPUESTAS DIRECTAS
        if (body.includes('medios de pago') || body.includes('numero de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'nuestras formas de pago:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
        }
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'su estado de cuenta:\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
        }
        else if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: saludoFormal + 'nuestra lista de precios actualizada:\n\nhttps://www.one4cars.com/lista_de_precios.php/' });
        }
        else if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: saludoFormal + 'realizar la carga de su pedido:\n\nhttps://www.one4cars.com/tomar_pedido.php/' });
        }
        else if (body.includes('mis clientes')) {
            await sock.sendMessage(from, { text: saludoFormal + 'gestionar su cartera de clientes:\n\nhttps://www.one4cars.com/acceso_vendedores.php/' });
        }
        else if (body.includes('ficha producto')) {
            await sock.sendMessage(from, { text: saludoFormal + 'consultar nuestras fichas técnicas:\n\nhttps://www.one4cars.com/consulta_productos.php/' });
        }
        else if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: saludoFormal + 'realizar el seguimiento de su despacho:\n\nhttps://www.one4cars.com/despacho_cliente_web.php/' });
        }
        else if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        }
        // MENÚ PRINCIPAL
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
                             'Escribe la frase de la opción que necesitas:\n\n' +
                             '📲 *Menú de Gestión Comercial*\n' +
                             '🏦 *Medios de Pago*\n' +
                             '📄 *Estado de Cuenta*\n' +
                             '💰 *Lista de Precios*\n' +
                             '🛒 *Tomar Pedido*\n' +
                             '👥 *Mis Clientes*\n' +
                             '⚙️ *Ficha Producto*\n' +
                             '🚚 *Despacho*\n' +
                             '👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

// --- SERVIDOR WEB MEJORADO (ARRANCA PRIMERO) ---
const port = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;">
            <h1>🚗 ASISTENTE ONE4CARS</h1>
            <img src="${qrCodeData}" width="300">
            <p>Escanea el código para activar el sistema permanente.</p>
            <button onclick="location.reload()">Refrescar</button>
        </center>`);
    } else if (qrCodeData === "BOT ONLINE ✅") {
        res.write(`<center style="font-family:Arial;padding-top:100px;">
            <h1 style="color:green;">✅ BOT ONE4CARS ONLINE</h1>
            <p>El sistema está trabajando correctamente y despertando cada 5 min.</p>
        </center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">🔄 Iniciando sistema...</h1><p>Si la página no carga el QR, refresca en 10 segundos.</p></center>`);
    }
    res.end();
});

// Arrancamos el servidor PRIMERO para que Cron-job y Render vean actividad rápido
server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor despierto en puerto ${port}`);
    // Una vez el servidor vive, arrancamos el bot de WhatsApp
    startBot();
});
