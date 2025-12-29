const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

let qrCodeData = "";
const authFolder = 'auth_info';

async function startBot() {
    // 1. GESTIÓN DE SESIÓN: Si hay error previo, intentamos limpiar
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        syncFullHistory: false, // No descargar historial para evitar saturar RAM
        shouldIgnoreJid: jid => jid.includes('broadcast'), // Ignorar estados
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
            console.log("⚠️ Nuevo QR generado. La sesión anterior no era válida.");
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const statusCode = (error instanceof Boom)?.output?.statusCode;
            const message = error?.output?.payload?.message || "";

            console.log(`Conexión cerrada. Código: ${statusCode}. Mensaje: ${message}`);

            // SI HAY ERROR DE "BAD MAC" O SESIÓN CORRUPTA (401)
            if (statusCode === 401 || message.includes('Bad MAC') || message.includes('Session error')) {
                console.log("🛑 Error crítico de sesión detectado. Limpiando carpeta de autenticación...");
                qrCodeData = "SESION_CORRUPTA";
                if (fs.existsSync(authFolder)) {
                    fs.rmSync(authFolder, { recursive: true, force: true });
                }
                setTimeout(() => startBot(), 2000);
            } else {
                // Reintento normal para otros errores de red
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    // --- RESPUESTAS AUTOMÁTICAS ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // Respuestas Directas
        if (body.includes('medios de pago') || body.includes('numero de cuenta') || body.includes('numeros de cuenta')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener nuestras formas de pago y números de cuenta:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
            return;
        }
        if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener su estado de cuenta detallado:\n\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php/' });
            return;
        }
        if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para obtener nuestra lista de precios actualizada:\n\nhttps://www.one4cars.com/lista_de_precios.php/' });
            return;
        }
        if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para realizar la carga de su pedido:\n\nhttps://www.one4cars.com/tomar_pedido.php/' });
            return;
        }
        if (body.includes('mis clientes')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para gestionar su cartera de clientes asignada:\n\nhttps://www.one4cars.com/acceso_vendedores.php/' });
            return;
        }
        if (body.includes('ficha producto')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para consultar nuestras fichas técnicas de productos:\n\nhttps://www.one4cars.com/consulta_productos.php/' });
            return;
        }
        if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: 'Saludos estimado ingrese al siguiente link para realizar el seguimiento de su despacho:\n\nhttps://www.one4cars.com/despacho_cliente_web.php/' });
            return;
        }
        if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento uno de nuestros asesores se comunicará con usted de forma manual.' });
            return;
        }

        // Saludos y Menú Principal
        const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buendía', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes'];
        if (saludos.some(s => body === s || body.includes(s))) {
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
    });
}

// --- SERVIDOR WEB ---
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData === "SESION_CORRUPTA") {
        res.write(`<center><h1>⚠️ Error de sesión detectado</h1><p>Estamos generando un nuevo QR para ti. Refresca en 5 segundos.</p><script>setTimeout(()=>location.reload(), 5000)</script></center>`);
    } else if (qrCodeData.includes("data:image")) {
        res.write(`<center style="font-family:Arial;padding-top:50px;"><h1>🚗 Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"><p>Escanea este código con tu WhatsApp.</p><button onclick="location.reload()">ACTUALIZAR</button></center>`);
    } else {
        res.write(`<center><h1 style="font-family:Arial;margin-top:100px;">${qrCodeData || "Iniciando..."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot();
