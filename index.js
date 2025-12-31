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

    // (Aquí va tu lógica de sock.ev.on('messages.upsert'...) con los botones que ya tienes)
}

const port = process.env.PORT || 10000;
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        // Capturamos filtros de la URL
        const filtros = {
            vendedor: parsedUrl.query.vendedor || '',
            zona: parsedUrl.query.zona || '',
            dias: parsedUrl.query.dias || 300
        };

        deudoresEnMemoria = await obtenerListaDeudores(filtros);
        
        let items = deudoresEnMemoria.map((d, i) => {
            const fecha = new Date(d.fecha_reg).toISOString().split('T')[0]; // Quita el GMT largo
            return `
            <div class="debt-card">
                <div class="card-check">
                    <input type="checkbox" name="c_${i}" value="${d.celular}" checked class="user-check">
                </div>
                <div class="card-info">
                    <div class="client-name">${d.nombres}</div>
                    <div class="factura-info">Factura: <b>${d.nro_factura}</b> • ${fecha}</div>
                    <div class="vendedor-tag">👤 ${d.vendedor || 'S/V'} • 📍 ${d.zona || 'S/Z'}</div>
                </div>
                <div class="card-amount-box">
                    <div class="card-amount">$${parseFloat(d.total).toFixed(2)}</div>
                    <div class="card-days">${d.dias_transcurridos} días</div>
                </div>
            </div>`;
        }).join('');

        res.write(`
        <!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
            body { font-family: -apple-system, system-ui, sans-serif; background: #f2f2f7; margin: 0; padding: 0; }
            .header { background: #007aff; color: white; padding: 20px 15px; text-align: center; }
            .filter-box { background: white; padding: 15px; border-bottom: 1px solid #d1d1d6; }
            .filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
            input, select { width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 8px; box-sizing: border-box; font-size: 14px; }
            .btn-filter { background: #007aff; color: white; border: none; width: 100%; padding: 12px; border-radius: 8px; font-weight: bold; margin-top: 10px; }
            .container { padding: 15px; padding-bottom: 100px; }
            .debt-card { background: white; border-radius: 12px; padding: 15px; margin-bottom: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .card-check { padding-right: 15px; }
            .card-info { flex-grow: 1; overflow: hidden; }
            .client-name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #1c1c1e; }
            .factura-info { font-size: 11px; color: #8e8e93; }
            .vendedor-tag { font-size: 10px; background: #e5e5ea; display: inline-block; padding: 2px 6px; border-radius: 4px; margin-top: 4px; }
            .card-amount-box { text-align: right; min-width: 80px; }
            .card-amount { font-weight: 800; color: #ff3b30; font-size: 15px; }
            .card-days { font-size: 11px; font-weight: bold; color: #ff9500; }
            .footer { position: fixed; bottom: 0; width: 100%; background: white; padding: 15px; border-top: 1px solid #ccc; box-sizing: border-box; }
            .btn-send { background: #34c759; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: 700; width: 100%; font-size: 16px; }
            .toolbar { display: flex; justify-content: space-between; padding: 10px 5px; font-size: 12px; font-weight: bold; }
        </style>
        </head><body>
        <div class="header">
            <h2 style="margin:0; font-size:18px;">Cobranza ONE4CARS 🚗</h2>
        </div>
        
        <div class="filter-box">
            <form action="/cobrar-ahora" method="GET">
                <div class="filter-grid">
                    <input type="text" name="vendedor" placeholder="Vendedor" value="${filtros.vendedor}">
                    <input type="text" name="zona" placeholder="Zona" value="${filtros.zona}">
                </div>
                <select name="dias">
                    <option value="30" ${filtros.dias == 30 ? 'selected' : ''}>+30 días</option>
                    <option value="90" ${filtros.dias == 90 ? 'selected' : ''}>+90 días</option>
                    <option value="300" ${filtros.dias == 300 ? 'selected' : ''}>+300 días</option>
                </select>
                <button type="submit" class="btn-filter">🔍 Aplicar Filtros</button>
            </form>
        </div>

        <div class="container">
            <form action="/confirmar-envio" method="GET">
                <div class="toolbar">
                    <span>${deudoresEnMemoria.length} ENCONTRADOS</span>
                    <label><input type="checkbox" checked onclick="const c=document.getElementsByClassName('user-check');for(let i=0;i<c.length;i++)c[i].checked=this.checked"> TODOS</label>
                </div>
                ${items || '<p style="text-align:center; color:gray;">Sin resultados</p>'}
                ${deudoresEnMemoria.length > 0 ? '<div class="footer"><button type="submit" class="btn-send">🚀 ENVIAR WHATSAPP</button></div>' : ''}
            </form>
        </div>
        </body></html>`);
        res.end();
    } 
    // (Rutas /confirmar-envio y Home se mantienen igual)
    else if (parsedUrl.pathname === '/confirmar-envio') {
        const query = parsedUrl.query;
        const seleccionados = Object.values(query);
        const aEnviar = deudoresEnMemoria.filter(d => seleccionados.includes(d.celular));
        res.write(`<h1>🚀 Enviando a ${aEnviar.length} clientes...</h1>`);
        res.end();
        if (global.sockBot && aEnviar.length > 0) ejecutarEnvioMasivo(global.sockBot, aEnviar);
    } 
    else {
        res.write(`<center style="padding-top:100px;">${qrCodeData.includes("data:image") ? `<h2>Escanea el QR</h2><img src="${qrCodeData}" width="300">` : `<h2>✅ BOT ONLINE</h2><a href="/cobrar-ahora">Ir al Panel de Cobranza</a>`}</center>`);
        res.end();
    }
}).listen(port, '0.0.0.0', () => {
    console.log("Dashboard Filtros OK");
    startBot();
});
