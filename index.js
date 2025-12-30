const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

// ========================================================
// 1. TU ENLACE MONGODB (Ya corregido con tu clave)
const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
// ========================================================

let qrCodeData = "";

// Conexión a Base de Datos para monitoreo
mongoose.connect(mongoURI).then(() => console.log("✅ Memoria MongoDB activa")).catch(err => console.log("❌ Error Base Datos"));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // Forzamos una versión ligera para evitar el error 515
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silencio total de logs (ahorra mucha RAM)
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"],
        syncFullHistory: false, // NO descargar chats viejos
        markOnlineOnConnect: false,
        // ESTO ES LO MÁS IMPORTANTE: Ignorar grupos y estados para no colapsar
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us'),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            console.log(`Conexión cerrada. Código: ${statusCode}`);
            // Si no es cierre manual, reconectar en 10 segundos
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 10000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS EN LÍNEA Y ESTABLE');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        // Solo responder a mensajes de texto, individuales y que no sean nuestros
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoFormal = 'Saludos estimado, ingrese al siguiente link para obtener ';

        // --- LÓGICA DE RESPUESTAS DIRECTAS ---
        if (body.includes('medios de pago') || body.includes('numero de cuenta')) {
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
        // --- MENÚ PRINCIPAL ---
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'buen día'];
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;"><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"><p>Activa tu bot estable para ONE4CARS</p></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">${qrCodeData || "Iniciando sistema..."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot();
