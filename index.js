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
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // 1. MEDIOS DE PAGO
        if (body.includes('medios de pago')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener nuestras formas de pago\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
            return;
        }
        // 2. ESTADO DE CUENTA
        if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener su estado de cuenta detallado\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
            return;
        }
        // 3. LISTA DE PRECIOS
        if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener nuestra lista de precios actualizada\n\nhttps://www.one4cars.com/lista_de_precios.php/' });
            return;
        }
        // 4. TOMAR PEDIDO
        if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para realizar la carga de su pedido\n\nhttps://www.one4cars.com/tomar_pedido.php/' });
            return;
        }
        // 5. MIS CLIENTES
        if (body.includes('mis clientes')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para gestionar su cartera de clientes\n\nhttps://www.one4cars.com/acceso_vendedores.php/' });
            return;
        }
        // 6. FICHA PRODUCTO
        if (body.includes('ficha producto')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para consultar nuestras fichas técnicas de productos\n\nhttps://www.one4cars.com/ficha_producto.php/' });
            return;
        }
        // 7. DESPACHO
        if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para realizar el seguimiento de su despacho\n\nhttps://www.one4cars.com/despacho_cliente_web.php/' });
            return;
        }
        // 8. ASESOR
        if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento uno de nuestros asesores humanos se pondrá en contacto con usted de forma manual.' });
            return;
        }

        // --- MENÚ PRINCIPAL (Activado por saludos) ---
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

// Servidor para Render
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
