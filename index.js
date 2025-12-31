// const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas } = require('./cobranza');

// ========================================================
// 1. CONFIGURACIÓN PERMANENTE
const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
// ========================================================

let qrCodeData = "";
global.sockBot = null;
let deudoresEnMemoria = []; 

// Conexión a MongoDB para la persistencia de la sesión
mongoose.connect(mongoURI)
    .then(() => console.log("✅ Memoria permanente MongoDB conectada"))
    .catch(err => console.error("❌ Error MongoDB:", err.message));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"],
        syncFullHistory: false, // No descarga chats viejos para ahorrar RAM
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us'), // Ignora estados y grupos
        connectTimeoutMs: 60000
    });

    global.sockBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeData = url; 
                console.log("✅ Nuevo QR generado.");
            });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("🔄 Conexión perdida, reintentando...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS EN LÍNEA');
        }
    });

    // --- LÓGICA DE MENSAJES ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoEnlace = 'Saludos estimado, toque el siguiente enlace para ';

        // 1. RESPUESTAS POR BOTONES / PALABRAS CLAVE
        if (body.includes('medios de pago') || body.includes('numero de cuenta')) {
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
        // 2. MENÚ PRINCIPAL
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

// --- SERVIDOR DASHBOARD PROFESIONAL ---
const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        const vendedores = await obtenerVendedores();
        const zonas = await obtenerZonas();
        
        const filtros = {
            id_vendedor: parsedUrl.query.id_vendedor || '',
            id_zona: parsedUrl.query.id_zona || '',
            dias: parsedUrl.query.dias || 300
        };

        deudoresEnMemoria = await obtenerListaDeudores(filtros);
        
        const optVendedores = vendedores.map(v => `<option value="${v.id_vendedor}" ${filtros.id_vendedor == v.id_vendedor ? 'selected' : ''}>${v.nombre}</option>`).join('');
        const optZonas = zonas.map(z => `<option value="${z.id_zona}" ${filtros.id_zona == z.id_zona ? 'selected' : ''}>${z.zona}</option>`).join('');

        let items = deudoresEnMemoria.map((d, i) => `
            <div class="debt-card">
                <div class="card-check"><input type="checkbox" name="c_${i}" value="${d.celular}" checked class="user-check"></div>
                <div class="card-info">
                    <div class="client-name">${d.nombres}</div>
                    <div class="factura-info">Fac: <b>${d.nro_factura}</b> • ${d.vendedor_nom || 'S/V'}</div>
                    <div class="zona-tag">📍 ${d.zona_nom || 'Sin Zona'}</div>
                </div>
                <div class="card-amount-box">
                    <div class="card-amount">$${parseFloat(d.total).toFixed(2)}</div>
                    <div class="card-days">${d.dias_transcurridos} días</div>
                </div>
            </div>`).join('');

        res.write(`
        <!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f2f2f7; margin: 0; padding-bottom: 100px; }
            .header { background: #007aff; color: white; padding: 15px; text-align: center; position: sticky; top: 0; z-index: 10; }
            .filter-box { background: white; padding: 15px; border-bottom: 1px solid #d1d1d6; }
            select, input { width: 100%; padding: 12px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 10px; font-size: 14px; background: #f8f8f8; -webkit-appearance: none; }
            .btn-filter { background: #007aff; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: bold; width: 100%; cursor: pointer; }
            .container { padding: 10px; }
            .debt-card { background: white; border-radius: 15px; padding: 15px; margin-bottom: 10px; display: flex; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .card-info { flex-grow: 1; overflow: hidden; padding-left: 10px; }
            .client-name { font-weight: bold; font-size: 14px; text-transform: uppercase; color: #1c1c1e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .factura-info { font-size: 11px; color: #8e8e93; margin-top: 2px; }
            .zona-tag { font-size: 10px; color: #007aff; font-weight: bold; margin-top: 4px; }
            .card-amount-box { text-align: right; min-width: 90px; }
            .card-amount { font-weight: 800; color: #ff3b30; font-size: 16px; }
            .card-days { font-size: 11px; background: #fff2e0; color: #ff9500; padding: 2px 5px; border-radius: 4px; display: inline-block; margin-top: 4px; }
            .footer { position: fixed; bottom: 0; width: 100%; background: rgba(255,255,255,0.9); padding: 15px; border-top: 1px solid #ddd; backdrop-filter: blur(10px); box-sizing: border-box; }
            .btn-send { background: #34c759; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: bold; width: 100%; font-size: 16px; box-shadow: 0 4px 10px rgba(52,199,89,0.3); }
            input[type="checkbox"] { width: 22px; height: 22px; accent-color: #007aff; }
        </style>
        <script>
            function toggleAll(source) {
                const checkboxes = document.getElementsByClassName('user-check');
                for(let i=0; i<checkboxes.length; i++) checkboxes[i].checked = source.checked;
            }
        </script>
        </head><body>
        <div class="header"><h2 style="margin:0; font-size:18px;">Cobranza ONE4CARS 🚗</h2></div>
        <div class="filter-box">
            <form action="/cobrar-ahora" method="GET">
                <select name="id_vendedor"><option value="">Todos los Vendedores</option>${optVendedores}</select>
                <select name="id_zona"><option value="">Todas las Zonas</option>${optZonas}</select>
                <input type="number" name="dias" placeholder="Mínimo de días vencidos" value="${filtros.dias}">
                <button type="submit" class="btn-filter">🔍 Generar Reporte</button>
            </form>
        </div>
        <div class="container">
            <form action="/confirmar-envio" method="GET">
                <div style="display:flex; justify-content:space-between; padding: 10px; font-size: 12px; font-weight: bold; color: #666;">
                    <span>${deudoresEnMemoria.length} FACTURAS</span>
                    <label style="display:flex; align-items:center; gap:5px;"><input type="checkbox" checked onclick="toggleAll(this)"> TODOS</label>
                </div>
                ${items || '<p style="text-align:center; padding:20px; color:#999;">No hay resultados.</p>'}
                ${deudoresEnMemoria.length > 0 ? '<div class="footer"><button type="submit" class="btn-send">🚀 ENVIAR WHATSAPP</button></div>' : ''}
            </form>
        </div>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        const query = parsedUrl.query;
        const seleccionados = Object.values(query);
        const aEnviar = deudoresEnMemoria.filter(d => seleccionados.includes(d.celular));
        res.write('<html><body style="font-family:sans-serif; text-align:center; padding-top:50px;"><h1>🚀 Envío Iniciado</h1><p>Enviando a '+aEnviar.length+' clientes.</p><a href="/cobrar-ahora">Volver</a></body></html>');
        res.end();
        if (global.sockBot && aEnviar.length > 0) ejecutarEnvioMasivo(global.sockBot, aEnviar);
    } 
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="padding-top:50px;"><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center style="padding-top:100px;"><h1>✅ BOT ONLINE</h1><p><a href="/cobrar-ahora">Ir al Panel de Cobranza</a></p></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor activo puerto ${port}`);
    startBot();
});
