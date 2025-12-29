const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

let qrCodeData = "";

async function startBot() {
    // Carpeta 'auth_info' guardará tu sesión para no escanear siempre
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
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeData = url; 
                console.log("✅ Nuevo QR generado. Refresca tu link de Render.");
            });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`Conexión cerrada. Reconectando: ${shouldReconnect}`);
            if (shouldReconnect) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 CONECTADO A WHATSAPP - ONE4CARS');
        }
    });

    // --- LÓGICA DE MENSAJES Y AUTO-RESPUESTAS ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // 1. LISTA EXTENDIDA DE SALUDOS
        const saludos = [
             'buendia', 'buen dia', 'buen día', 'buendía', 
            'buenos dias', 'buenos días', 'buenosdias', 'buenosdías', 
            'buenas tardes', 'buenas noches', 'saludos', 'que tal', 
            'bns dias', 'bns días', 'bns tardes'
        ];

        const esSaludo = saludos.some(s => body.includes(s));

        // --- RESPUESTA: MENÚ PRINCIPAL ---
        if (esSaludo && !body.includes('pago') && !body.includes('precio') && !body.includes('cuenta') && !body.includes('pedido')) {
            const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
                         'Para ayudarte de forma precisa, por favor escribe la *frase de la opción* que necesitas:\n\n' +
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

        // --- RESPUESTA: MEDIOS DE PAGO ---
        else if (body.includes('medios de pago') || body.includes('pago movil') || body.includes('zelle')) {
            await sock.sendMessage(from, { text: '🏦 *MEDIOS DE PAGO ONE4CARS*\n\n🔹 *Zelle:* pagos@one4cars.com\n🔹 *Pago Móvil:* Banesco, RIF J-12345678, Tel: 0412-1234567\n🔹 *Transferencia:* Solicita las cuentas aquí.\n\n_Envía el comprobante por este chat._' });
        }

        // --- RESPUESTA: ESTADO DE CUENTA ---
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: '📄 *ESTADO DE CUENTA*\n\nPor favor, indica tu *RIF o Nombre de empresa* para generar tu reporte de facturas.' });
        }

        // --- RESPUESTA: LISTA DE PRECIOS ---
        else if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: '💰 *LISTA DE PRECIOS*\n\nPuedes descargar nuestro catálogo actualizado aquí:\n🔗 https://tu-link-aqui.com/precios' });
        }

        // --- RESPUESTA: TOMAR PEDIDO ---
        else if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: '🛒 *TOMAR PEDIDO*\n\nIndica el *Código del Producto* y la *Cantidad*. Nuestro equipo de ventas procesará tu orden de inmediato.' });
        }

        // --- RESPUESTA: ASESOR ---
        else if (body.includes('asesor') || body.includes('humano')) {
            await sock.sendMessage(from, { text: '👤 *ASESOR HUMANO*\n\nEntendido. He notificado a nuestro equipo. Un ejecutivo se comunicará contigo de forma manual en breve.' });
        }

        // --- RESPUESTA: DESPACHO ---
        else if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: '🚚 *ESTATUS DE DESPACHO*\n\nIndica tu número de factura o pedido para rastrear el envío de tu mercancía.' });
        }
    });
}

// --- SERVIDOR WEB PARA EL QR ---
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`
            <center style="font-family:Arial; padding-top: 50px;">
                <h1 style="color:#2c3e50;">🚗 Asistente ONE4CARS</h1>
                <div style="background: white; padding: 20px; display: inline-block; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    <img src="${qrCodeData}" style="width:350px;">
                </div>
                <p style="font-size:18px; color:#666; margin-top:20px;">Abre WhatsApp en tu iPhone y escanea el código.</p>
                <button onclick="location.reload()" style="background:#25D366; color:white; border:none; padding:10px 20px; border-radius:5px; cursor:pointer; font-weight:bold;">ACTUALIZAR QR</button>
            </center>
        `);
    } else {
        res.write(`<center><h1 style="font-family:Arial; margin-top:100px;">${qrCodeData || "Conectando al servidor... refresca en 5 segundos."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot().catch(err => console.error("Error inicial:", err));
