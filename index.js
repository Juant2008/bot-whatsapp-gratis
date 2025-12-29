const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

let qrCodeData = "";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        // Obtenemos el texto del mensaje y lo limpiamos
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // 1. RESPUESTA ESPECÍFICA: MEDIOS DE PAGO
        if (body.includes('medios de pago')) {
            await sock.sendMessage(from, { 
                text: 'Saludos estimado ingrese al siguiente link para obtener nuestras formas de pago\n\nhttps://www.one4cars.com/medios_de_pago.php/' 
            });
            return; // Detenemos aquí para que no mande el menú también
        }

        // 2. LISTA DE SALUDOS PARA EL MENÚ PRINCIPAL
        const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'saludos'];
        const esSaludo = saludos.some(s => body === s || body.includes(s));

        if (esSaludo) {
            const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
                         'Para ayudarte de forma precisa, por favor escribe la frase de la opción que necesitas:\n\n' +
                         '📲 *Menú de Gestión Comercial*\n\n' +
                         '🏦 *Medios de Pago* — (Transferencia / Pago Móvil / Zelle)\n\n' +
                         '📄 *Estado de Cuenta* — (Reporte detallado de facturas)\n\n' +
                         '💰 *Lista de Precios* — (Listado de productos actualizado)\n\n' +
                         '🛒 *Tomar Pedido* — (Cargar pedido de clientes)\n\n' +
                         '👥 *Mis Clientes* — (Tu cartera de clientes asignada)\n\n' +
                         '⚙️ *Ficha Producto* — (Consultar fichas técnicas)\n\n' +
                         '🚚 *Despacho* — (Estatus y seguimiento de tu orden)\n\n' +
                         '👤 *Asesor* — (Hablar con un humano)';
            
            await sock.sendMessage(from, { text: menu });
        }
        
        // 3. OTRAS OPCIONES (Si las necesitas)
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: '📄 Por favor, indíquenos su RIF para generar su estado de cuenta.' });
        }
    });
}

// Servidor para el QR y Cron-Job
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;"><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">${qrCodeData || "Iniciando..."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot();
