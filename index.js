const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const { obtenerListaDeudores, ejecutarEnvioMasivo } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
let qrCodeData = "";
global.sockBot = null;
let deudoresPendientes = []; // Memoria temporal para la confirmación

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
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoFormal = 'Saludos estimado, ingrese al siguiente link para ';

        if (body.includes('medios de pago')) {
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
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n👥 *Afiliar Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

// --- SERVIDOR WEB PROFESIONAL ---
const port = process.env.PORT || 10000;
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    // RUTA 1: Vista Previa de Deudores
    if (req.url === '/cobrar-ahora') {
        deudoresPendientes = await obtenerListaDeudores();
        let tabla = deudoresPendientes.map(d => `<tr><td>${d.nombres}</td><td>${d.nro_factura}</td><td>${d.total}</td><td>${d.celular}</td></tr>`).join('');
        
        res.write(`
            <html><head><style>
                body { font-family: Arial; background: #f4f4f4; text-align: center; }
                table { width: 90%; margin: 20px auto; border-collapse: collapse; background: white; }
                th, td { border: 1px solid #ddd; padding: 12px; }
                th { background: #2c3e50; color: white; }
                .btn { background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            </style></head><body>
                <h1>📋 Lista de Cobranza (>30 días)</h1>
                <p>Se encontraron <b>${deudoresPendientes.length}</b> facturas pendientes.</p>
                <table>
                    <tr><th>Cliente</th><th>Factura</th><th>Monto</th><th>WhatsApp</th></tr>
                    ${tabla}
                </table>
                <br>
                ${deudoresPendientes.length > 0 ? `<a href="/confirmar-envio" class="btn">🚀 CONFIRMAR Y ENVIAR MENSAJES</a>` : '<b>No hay deudas vencidas.</b>'}
            </body></html>
        `);
        res.end();
    } 
    // RUTA 2: Ejecución tras confirmación
    else if (req.url === '/confirmar-envio') {
        res.write('<h1>🚀 Envío en progreso...</h1><p>El bot está enviando los mensajes cada 30 segundos para evitar bloqueos. Puedes cerrar esta ventana.</p>');
        res.end();
        if (global.sockBot && deudoresPendientes.length > 0) {
            ejecutarEnvioMasivo(global.sockBot, deudoresPendientes).then(() => deudoresPendientes = []);
        }
    } 
    // RUTA 3: Home (QR)
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center><h1>✅ BOT ONLINE</h1><p>Visita <a href="/cobrar-ahora">/cobrar-ahora</a> para ver deudores.</p></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0', () => {
    console.log("Servidor listo");
    startBot();
});
