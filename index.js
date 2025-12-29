const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

async function startBot() {
    // Carpeta donde se guarda la sesión (auth_info_baileys)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        printQRInTerminal: false // Ya no usamos la terminal para el QR
    });

    // Guardar credenciales cuando se actualizan
    sock.ev.on('creds.update', saveCreds);

    // Manejo de conexión
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeData = url; 
                console.log("✅ Nuevo código QR generado. Refresca la web.");
            });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. ¿Reconectando?:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ¡ONE4CARS Conectado a WhatsApp!');
        }
    });

    // --- LÓGICA DE MENSAJES (MENÚ COMPLETO) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        const saludos = ['hola', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes'];

        // 1. DISPARADOR DEL MENÚ
        if (saludos.some(s => body === s || body.includes(s)) && !body.includes('pago')) {
            const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\n' +
                         'Para ayudarte de forma precisa, por favor escribe la frase de la opción que necesitas:\n\n' +
                         '📲 *Menú de Gestión Comercial*\n\n' +
                         '🏦 *Medios de Pago* — (Transferencia / Pago Móvil / Zelle)\n' +
                         '📄 *Estado de Cuenta* — (Reporte detallado de facturas)\n' +
                         '💰 *Lista de Precios* — (Listado de productos actualizado)\n' +
                         '🛒 *Tomar Pedido* — (Cargar pedido de clientes)\n' +
                         '👥 *Mis Clientes* — (Tu cartera de clientes asignada)\n' +
                         '⚙️ *Ficha Producto* — (Consultar fichas técnicas)\n' +
                         '🚚 *Despacho* — (Estatus y seguimiento de tu orden)\n' +
                         '👤 *Asesor* — (Hablar con un humano)';
            
            await sock.sendMessage(from, { text: menu });
        }

        // 2. OPCIONES ESPECÍFICAS
        else if (body.includes('medios de pago')) {
            await sock.sendMessage(from, { text: '🏦 *MEDIOS DE PAGO*\n\n🔹 *Zelle:* pagos@one4cars.com\n🔹 *Pago Móvil:* Banesco, RIF J-12345678, Tel: 0412-1234567' });
        }
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: '📄 *ESTADO DE CUENTA*\n\nPor favor, indique su RIF o Nombre de empresa para generar su reporte.' });
        }
        else if (body.includes('lista de precios')) {
            await sock.sendMessage(from, { text: '💰 *LISTA DE PRECIOS*\n\nPuedes ver nuestro catálogo aquí: [TU_LINK]' });
        }
        else if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: '👤 *ASESOR*\n\nHe notificado a un asesor. En breve te atenderán de forma manual.' });
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
                <h1 style="color:#2c3e50;">Asistente ONE4CARS 🚗</h1>
                <div style="background: white; padding: 20px; display: inline-block; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    <img src="${qrCodeData}" style="width:350px;">
                </div>
                <p style="font-size:18px; color:#666; margin-top:20px;">Abre WhatsApp en tu iPhone y escanea el código.</p>
                <button onclick="location.reload()" style="padding:10px 20px; cursor:pointer;">Refrescar Pantalla</button>
            </center>
        `);
    } else {
        res.write(`<center><h1 style="font-family:Arial; margin-top:100px;">${qrCodeData || "Iniciando sistema... espera 10 segundos y refresca."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0', () => {
    console.log(`Servidor web activo en puerto ${port}`);
});

startBot().catch(err => console.error("Error al iniciar el bot:", err));
