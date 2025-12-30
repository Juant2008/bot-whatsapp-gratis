const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

// ========================================================
// ENLACE DE MONGODB CON TU CONTRASEÑA v6228688 YA INTEGRADA
const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
// ========================================================

let qrCodeData = "";

// Conexión a Base de Datos
mongoose.connect(mongoURI)
    .then(() => console.log("✅ Memoria permanente conectada (MongoDB)"))
    .catch(err => console.error("❌ ERROR DE AUTENTICACIÓN: Revisa que el usuario 'one4cars' tenga la contraseña 'v6228688' en el panel de MongoDB Atlas.", err.message));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        syncFullHistory: false,
        shouldIgnoreJid: jid => jid.includes('broadcast')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("🔄 Reconectando...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS EN LÍNEA');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoFormal = 'Saludos estimado ingrese al siguiente link para obtener ';

        // --- OPCIONES DEL MENÚ ---
        if (body.includes('medios de pago') || body.includes('numero de cuenta') || body.includes('numeros de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'nuestras formas de pago:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
        }
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'su estado de cuenta:\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
        }
        else if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: saludoFormal + 'nuestra lista de precios:\n\nhttps://www.one4cars.com/lista_de_precios.php/' });
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

        // --- SALUDO INICIAL / MENÚ ---
        const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'buen día'];
        if (saludos.some(s => body === s || body.includes(s)) && !body.includes('http')) {
            const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
            await sock.sendMessage(from, { text: menu });
        }
    });
}

const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;"><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"><p>Activa tu bot para ONE4CARS</p></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">${qrCodeData || "Conectando... refresca en 10 segundos."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot();
