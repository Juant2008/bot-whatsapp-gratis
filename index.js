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
let listaTemporal = []; 

mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB OK")).catch(err => console.log("❌ Error MongoDB"));

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
        
        // --- TEXTO BASE PARA TUS BOTONES ---
        const saludoEnlace = 'Saludos estimado, toque el siguiente enlace para ';

        // --- LÓGICA DE RESPUESTAS ADAPTADA ---
        if (body.includes('medios de pago')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
        }
        else if (body.includes('estado de cuenta')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        }
        else if (body.includes('lista de precios') || body.includes('listas de precios')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
        }
        else if (body.includes('tomar pedido')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} realizar su:\n\n👉 *TOMAR PEDIDO*\nhttps://www.one4cars.com/tomar_pedido.php` });
        }
        else if (body.includes('afiliar cliente')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
        }
        else if (body.includes('aprobar cliente')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} gestionar la:\n\n👉 *APROBACIÓN DE CLIENTE*\nhttps://www.one4cars.com/aprobadora_clientes.php` });
        }
        else if (body.includes('mis clientes')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} gestionar su:\n\n👉 *CARTERA DE CLIENTES*\nhttps://www.one4cars.com/acceso_vendedores.php` });
        }
        else if (body.includes('ficha producto')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} consultar la:\n\n👉 *FICHA DE PRODUCTO*\nhttps://www.one4cars.com/consulta_productos.php` });
        }
        else if (body.includes('despacho')) {
            await sock.sendMessage(from, { text: `${saludoEnlace} ver su:\n\n👉 *SEGUIMIENTO DE DESPACHO*\nhttps://www.one4cars.com/despacho_cliente_web.php` });
        }
        else if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        }
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

// --- SERVIDOR DASHBOARD Y COBRANZA ---
const port = process.env.PORT || 10000;
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url === '/cobrar-ahora') {
        listaTemporal = await obtenerListaDeudores();
        let rows = listaTemporal.map(d => `<tr><td>${d.nombres}</td><td>${d.nro_factura}</td><td>${d.total}</td><td>${d.fecha_reg}</td></tr>`).join('');
        res.write(`<html><head><style>body{font-family:Arial;text-align:center;background:#eee;}.card{background:white;width:95%;margin:10px auto;padding:20px;border-radius:10px;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:8px;font-size:12px;}th{background:#2c3e50;color:white;}.btn{display:inline-block;background:#27ae60;color:white;padding:15px;text-decoration:none;border-radius:5px;margin-top:20px;}</style></head><body><div class="card"><h2>📋 Cobranza ONE4CARS</h2><table><tr><th>Nombre</th><th>Factura</th><th>Monto</th><th>Fecha</th></tr>${rows || '<tr><td colspan="4">Sin deudores</td></tr>'}</table>${listaTemporal.length > 0 ? `<a href="/confirmar-envio" class="btn">ENVIAR WHATSAPP A TODOS</a>` : ''}</div></body></html>`);
        res.end();
    } 
    else if (req.url === '/confirmar-envio') {
        res.write('<h1>🚀 Envío iniciado</h1>'); res.end();
        if (global.sockBot && listaTemporal.length > 0) ejecutarEnvioMasivo(global.sockBot, listaTemporal).then(() => listaTemporal = []);
    } 
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center><h1>✅ BOT ONLINE</h1><p><a href="/cobrar-ahora">Ir al Panel de Cobranza</a></p></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0', () => {
    console.log("Servidor listo");
    startBot();
});
