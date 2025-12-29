const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const fs = require('fs');

let qrCodeData = "";

async function startBot() {
    // Carpeta 'auth_info' donde se guarda la sesión
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silenciamos logs para ahorrar RAM en Render
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        syncFullHistory: false, // Vital: No descarga chats viejos
        shouldIgnoreJid: jid => jid.includes('broadcast'), // Vital: Ignora Estados/Stories
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) {
                message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
            }
            return message;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            console.log(`Conexión cerrada: ${statusCode}`);

            // Si el error es 401 (Unauthorized), la sesión se corrompió
            if (statusCode === 401 || statusCode === DisconnectReason.loggedOut) {
                console.log("⚠️ Sesión corrupta o cerrada. Limpiando y generando nuevo QR...");
                qrCodeData = "";
                if (fs.existsSync('./auth_info')) {
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
                setTimeout(() => startBot(), 2000);
            } else {
                // Cualquier otro error, simplemente reintentar
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado correctamente');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // --- LÓGICA DE RESPUESTAS POR OPCIONES ---

        // Medios de Pago / Números de cuenta
        if (body.includes('medios de pago') || body.includes('numero de cuenta') || body.includes('numeros de cuenta')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener nuestras formas de pago y números de cuenta:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
            return;
        }

        // Estado de Cuenta
        if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener su estado de cuenta detallado:\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
            return;
        }

        // Lista de Precios
        if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener nuestra lista de precios actualizada:\n\nhttps://www.one4cars.com/lista_de_precios.php/' });
            return;
        }

        // Tomar Pedido
        if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para realizar la carga de su pedido:\n\nhttps://www.one4cars.com/tomar_pedido.php/' });
            return;
        }

        // Mis Clientes
        if (body.includes('mis clientes')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para gestionar su cartera de clientes asignada:\n\nhttps://www.one4cars.com/acceso_vendedores.php/' });
            return;
        }

        // Ficha Producto
        if (body.includes('ficha producto')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para consultar nuestras fichas técnicas de productos:\n\nhttps://www.one4cars.com/consulta_productos.php/' });
            return;
        }

        // Despacho
        if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para realizar el seguimiento de su despacho:\n\nhttps://www.one4cars.com/despacho_cliente_web.php/' });
            return;
        }

        // Asesor
        if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento uno de nuestros asesores se comunicará con usted de forma manual para apoyarle.' });
            return;
        }

        // --- MENÚ PRINCIPAL ---
        const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buendía', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes'];
        const esSaludo = saludos.some(s => body === s || body.includes(s));

        if (esSaludo) {
            const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
                         'Para ayudarte de forma precisa, por favor escribe la frase de la opción que necesitas:\n\n' +
                         '📲 *Menú de Gestión Comercial*\n\n' +
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
    });
}

// --- SERVIDOR WEB ---
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;"><h1>🚗 Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"><p>Escanea para activar el bot.</p><button onclick="location.reload()">ACTUALIZAR</button></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">${qrCodeData || "Iniciando sistema... espera 10 segundos."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot();
