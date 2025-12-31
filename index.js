const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?appName=one4cars";
let qrCodeData = "";
global.sockBot = null;
let deudoresEnMemoria = []; 

mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB OK")).catch(err => console.log("❌ Error MongoDB"));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version, auth: state, printQRInTerminal: false,
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
            if ((lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') { qrCodeData = "BOT ONLINE ✅"; }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoEnlace = 'Saludos estimado, toque el siguiente enlace para ';

        if (body.includes('medios de pago')) await sock.sendMessage(from, { text: `${saludoEnlace} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
        else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludoEnlace} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        else if (body.includes('lista de precios') || body.includes('listas de precios')) await sock.sendMessage(from, { text: `${saludoEnlace} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
        else if (body.includes('tomar pedido')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar su:\n\n👉 *TOMAR PEDIDO*\nhttps://www.one4cars.com/tomar_pedido.php` });
        else if (body.includes('afiliar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
        else if (body.includes('aprobar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} gestionar la:\n\n👉 *APROBACIÓN DE CLIENTE*\nhttps://www.one4cars.com/aprobadora_clientes.php` });
        else if (body.includes('mis clientes')) await sock.sendMessage(from, { text: `${saludoEnlace} gestionar su:\n\n👉 *CARTERA DE CLIENTES*\nhttps://www.one4cars.com/acceso_vendedores.php` });
        else if (body.includes('ficha producto')) await sock.sendMessage(from, { text: `${saludoEnlace} consultar la:\n\n👉 *FICHA DE PRODUCTO*\nhttps://www.one4cars.com/consulta_productos.php` });
        else if (body.includes('despacho')) await sock.sendMessage(from, { text: `${saludoEnlace} ver su:\n\n👉 *SEGUIMIENTO DE DESPACHO*\nhttps://www.one4cars.com/despacho_cliente_web.php` });
        else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*' });
            }
        }
    });
}

const port = process.env.PORT || 10000;
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        deudoresEnMemoria = await obtenerListaDeudores();
        
        let items = deudoresEnMemoria.map((d, i) => `
            <div class="debt-card">
                <div class="card-check">
                    <input type="checkbox" name="c_${i}" value="${d.celular}" checked class="user-check">
                </div>
                <div class="card-info">
                    <div class="client-name">${d.nombres}</div>
                    <div class="factura-info">Factura: <b>${d.nro_factura}</b> • ${d.fecha_reg}</div>
                </div>
                <div class="card-amount">$${parseFloat(d.total).toFixed(2)}</div>
            </div>`).join('');

        res.write(`
        <!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f2f2f7; margin: 0; padding: 0; color: #1c1c1e; }
            .header { background: #fff; padding: 20px 15px; border-bottom: 1px solid #d1d1d6; position: sticky; top: 0; z-index: 100; text-align: center; }
            .header h2 { margin: 0; font-size: 20px; color: #007aff; }
            .header p { margin: 5px 0 0; font-size: 13px; color: #8e8e93; }
            .container { padding: 15px; max-width: 600px; margin: auto; }
            .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding: 0 5px; }
            .select-all-label { font-size: 14px; display: flex; align-items: center; gap: 10px; font-weight: 500; }
            .debt-card { background: #fff; border-radius: 12px; padding: 15px; margin-bottom: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
            .card-check { padding-right: 15px; }
            .card-info { flex-grow: 1; }
            .client-name { font-weight: 700; font-size: 16px; margin-bottom: 3px; text-transform: uppercase; }
            .factura-info { font-size: 12px; color: #636366; }
            .card-amount { font-weight: 800; color: #ff3b30; font-size: 16px; }
            .footer { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.9); padding: 15px; border-top: 1px solid #d1d1d6; backdrop-filter: blur(10px); }
            .btn-send { background: #34c759; color: white; border: none; padding: 16px; border-radius: 14px; font-weight: 700; cursor: pointer; font-size: 17px; width: 100%; box-shadow: 0 4px 12px rgba(52,199,89,0.3); }
            input[type="checkbox"] { width: 22px; height: 22px; accent-color: #007aff; cursor: pointer; }
            .empty-msg { text-align: center; padding: 50px; color: #8e8e93; }
            .spacer { height: 100px; }
        </style>
        <script>
            function toggleAll(source) {
                const checkboxes = document.getElementsByClassName('user-check');
                for(let i=0; i<checkboxes.length; i++) checkboxes[i].checked = source.checked;
            }
        </script>
        </head><body>
        <div class="header">
            <h2>Gestión de Cobranza</h2>
            <p>ONE4CARS 🚗 • Deudas > 40 días</p>
        </div>
        <div class="container">
            <form action="/confirmar-envio" method="GET">
                <div class="toolbar">
                    <label class="select-all-label"><input type="checkbox" id="master" checked onclick="toggleAll(this)"> Seleccionar Todos</label>
                    <span style="font-size: 14px; font-weight: 600;">${deudoresEnMemoria.length} facturas</span>
                </div>
                ${items || '<div class="empty-msg">No se encontraron facturas vencidas</div>'}
                <div class="spacer"></div>
                ${deudoresEnMemoria.length > 0 ? '<div class="footer"><button type="submit" class="btn-send">Enviar WhatsApp a Seleccionados</button></div>' : ''}
            </form>
        </div>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        const query = parsedUrl.query;
        const seleccionados = Object.values(query);
        const aEnviar = deudoresEnMemoria.filter(d => seleccionados.includes(d.celular));

        res.write(`
        <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>body{font-family:sans-serif; text-align:center; padding:40px 20px; background:#f2f2f7;} .box{background:#fff; padding:30px; border-radius:20px; box-shadow:0 4px 10px rgba(0,0,0,0.1);} h1{color:#34c759;} .back{display:inline-block; margin-top:20px; color:#007aff; text-decoration:none; font-weight:600;}</style>
        </head><body><div class="box"><h1>🚀 Envío en marcha</h1><p>Procesando <b>${aEnviar.length}</b> recordatorios.</p><p style="font-size:13px; color:#8e8e93;">Intervalo de seguridad: 30 segundos por mensaje.</p><a href="/cobrar-ahora" class="back">← Volver al Panel</a></div></body></html>`);
        res.end();

        if (global.sockBot && aEnviar.length > 0) ejecutarEnvioMasivo(global.sockBot, aEnviar);
    } 
    else {
        res.write(`<center style="font-family:sans-serif; padding-top:100px;">
            ${qrCodeData.includes("data:image") ? `<h2>Conectar Bot ONE4CARS</h2><img src="${qrCodeData}" width="280">` : `<h2>✅ SISTEMA ACTIVO</h2><a href="/cobrar-ahora" style="color:#007aff; font-size:18px; text-decoration:none; font-weight:bold;">👉 Entrar al Panel de Cobranza</a>`}
        </center>`);
        res.end();
    }
}).listen(port, '0.0.0.0', () => {
    console.log("Servidor Dashboard Pro OK");
    startBot();
});
