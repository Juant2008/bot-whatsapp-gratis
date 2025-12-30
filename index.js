const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const { ejecutarCobranza } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
let qrCodeData = "";
global.sockBot = null;

mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB Conectado")).catch(err => console.log("❌ Error MongoDB"));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"],
        syncFullHistory: false,
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us')
    });

    global.sockBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS EN LÍNEA');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoFormal = 'Saludos estimado, ingrese al siguiente link para ';

        // --- LÓGICA DE RESPUESTAS (RESTABLECIDA SEGÚN TU ÚLTIMA VERSIÓN) ---
        
        if (body.includes('medios de pago') || body.includes('numero de cuenta') || body.includes('numeros de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'obtener nuestras formas de pago:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
        }
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'obtener su estado de cuenta:\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
        }
        else if (body.includes('lista de precios') || body.includes('listas de precios')) {
            await sock.sendMessage(from, { text: saludoFormal + 'nuestra lista de precios actualizada:\n\nhttps://www.one4cars.com/lista_de_precios.php/' });
        }
        else if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: saludoFormal + 'realizar la carga de su pedido:\n\nhttps://www.one4cars.com/tomar_pedido.php/' });
        }
        else if (body.includes('afiliar cliente')) {
            await sock.sendMessage(from, { text: saludoFormal + 'realizar la afiliación:\n\nhttps://www.one4cars.com/afiliacion_cliente.php/' });
        }
        else if (body.includes('aprobar cliente')) {
            await sock.sendMessage(from, { text: saludoFormal + 'gestionar aprobaciones de clientes:\n\nhttps://www.one4cars.com/aprobadora_clientes.php/' });
        }
        else if (body.includes('mis clientes')) {
            await sock.sendMessage(from, { text: saludoFormal + 'gestionar su cartera de clientes:\n\nhttps://www.one4cars.com/acceso_vendedores.php/' });
        }
        else if (body.includes('ficha producto')) {
            await sock.sendMessage(from, { text: saludoFormal + 'consultar nuestras fichas técnicas:\n\nhttps://www.one4cars.com/consulta_productos.php/' });
        }
        else if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: saludoFormal + 'el seguimiento de su despacho:\n\nhttps://www.one4cars.com/despacho_cliente_web.php/' });
        }
        else if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        }
        // --- MENÚ PRINCIPAL ---
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body === s || body.includes(s)) && !body.includes('http')) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n👥 *Afiliar Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    if (req.url === '/cobrar-ahora') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('<h1>🚀 Ejecutando cobranza masiva...</h1>');
        res.end();
        if (global.sockBot) ejecutarCobranza(global.sockBot).catch(e => console.log(e));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center><h1>✅ BOT ONLINE</h1><p>ONE4CARS Activo.</p></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor activo puerto ${port}`);
    startBot();
});
