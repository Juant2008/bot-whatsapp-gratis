const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

// ==========================================
// CONFIGURACIÓN MONGODB (PEGA TU ENLACE AQUÍ)
const mongoURI = "TU_ENLACE_DE_MONGODB_CON_CONTRASEÑA";
// ==========================================

let qrCodeData = "";

// Conectar a MongoDB
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ Memoria permanente conectada (MongoDB)"))
    .catch(err => console.error("❌ Error conectando a MongoDB:", err));

async function startBot() {
    // Usamos el sistema de archivos de Render (se borrará el archivo físico, 
    // pero la sesión de WhatsApp es más resistente con este motor ligero)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        syncFullHistory: false, // Vital para no saturar memoria
        shouldIgnoreJid: jid => jid.includes('broadcast') // Ignorar estados
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            // Si el error no es porque tú cerraste sesión, se reconecta solo
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("Reconectando bot...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS ESTÁ EN LÍNEA');
        }
    });

    // --- LÓGICA DE MENSAJES Y MENÚ ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // 1. LISTA DE SALUDOS (Activa el menú principal)
        const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes'];
        const esSaludo = saludos.some(s => body === s || body.includes(s));

        if (esSaludo && !body.includes('pago') && !body.includes('precio') && !body.includes('cuenta')) {
            const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
                         'Para ayudarte de forma precisa, por favor escribe la frase de la opción que necesitas:\n\n' +
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
            return;
        }

        // 2. OPCIONES ESPECÍFICAS CON SALUDO Y LINK
        const saludoFormal = 'Saludos estimado ingrese al siguiente link para obtener ';

        if (body.includes('medios de pago') || body.includes('numero de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'nuestras formas de pago y números de cuenta:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
        }
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: saludoFormal + 'su estado de cuenta detallado:\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
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
    });
}

// Servidor Web para el QR y Cron-Job
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;"><h1>🚗 ONE4CARS - ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"><p>Escanea este código para activar tu bot permanente.</p></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">${qrCodeData || "Iniciando sistema... refresca en 10 segundos."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot();
