const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("Reconectando...");
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // --- CONFIGURACIÓN DE RESPUESTAS ONE4CARS ---
        const titulo = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";
        
        const respuestas = {
            'medios de pago': 'Estimado cliente, acceda al siguiente enlace para ver nuestras formas de pago actualizadas:\n\n🔗 https://www.one4cars.com/medios_de_pago.php',
            'estado de cuenta': 'Estimado cliente, puede consultar su estado de cuenta detallado en el siguiente link:\n\n🔗 https://www.one4cars.com/estado_de_cuenta.php',
            'lista de precio': 'Estimado cliente, descargue nuestra lista de precios más reciente aquí:\n\n🔗 https://www.one4cars.com/lista_de_precios.php',
            'tomar pedido': 'Estimado cliente, inicie la carga de su pedido de forma rápida aquí:\n\n🔗 https://www.one4cars.com/tomar_pedido.php',
            'mis cliente': 'Estimado, gestione su cartera de clientes en el siguiente apartado:\n\n🔗 https://www.one4cars.com/mis_clientes.php',
            'afiliar cliente': 'Estimado, para afiliar nuevos clientes por favor ingrese al siguiente link:\n\n🔗 https://www.one4cars.com/afiliar_clientes.php',
            'ficha producto': 'Estimado cliente, consulte las especificaciones y fichas técnicas aquí:\n\n🔗 https://www.one4cars.com/consulta_productos.php',
            'despacho': 'Estimado cliente, realice el seguimiento en tiempo real de su despacho aquí:\n\n🔗 https://www.one4cars.com/despacho.php',
            'asesor': 'Entendido. En un momento uno de nuestros asesores humanos revisará su caso y le contactará de forma manual. Gracias por su paciencia.'
        };

        let respondido = false;
        for (const [key, val] of Object.entries(respuestas)) {
            if (body.includes(key)) {
                await sock.sendMessage(from, { text: titulo + val });
                respondido = true;
                break;
            }
        }

        if (!respondido) {
            const saludos = ['hola', 'buendia', 'buen dia', 'buen día', 'buendía', 'buenos dias', 'buenos días', 'saludos', 'buenas tardes', 'buenas noches'];
            if (saludos.some(s => body === s || body.includes(s))) {
                const menu = '¡Hola! Bienvenido a *ONE4CARS* 🚗💨\n\n' +
                             'Soy tu asistente virtual. Para ayudarte rápidamente, escribe la *palabra clave* de lo que necesitas:\n\n' +
                             '🏦 *Medios de Pago*\n' +
                             '📄 *Estado de Cuenta*\n' +
                             '💰 *Lista de Precios*\n' +
                             '🛒 *Tomar Pedido*\n' +
                             '👥 *Afiliar Cliente*\n' +
                             '👥 *Mis Clientes*\n' +
                             '⚙️ *Ficha Producto*\n' +
                             '🚚 *Despacho*\n' +
                             '👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

// Servidor HTTP para Panel de Control y Webhooks
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        try {
            const vendedores = await cobranza.obtenerVendedores();
            const zonas = await cobranza.obtenerZonas();
            const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <html>
                <head>
                    <title>ONE4CARS - Cobranza</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>body{background:#f8f9fa} .container{margin-top:20px; background:white; padding:20px; border-radius:10px; box-shadow:0 0 10px rgba(0,0,0,0.1)}</style>
                </head>
                <body>
                    <div class="container">
                        <div class="d-flex justify-content-between align-items-center">
                            <h2>📊 Panel de Cobranza</h2>
                            <a href="/" class="btn btn-sm btn-outline-secondary">Volver al QR</a>
                        </div>
                        <hr>
                        <form method="GET" class="row g-2 mb-4">
                            <div class="col-md-3">
                                <label class="form-label">Vendedor</label>
                                <select name="vendedor" class="form-select form-select-sm">
                                    <option value="">Todos</option>
                                    ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label">Zona</label>
                                <select name="zona" class="form-select form-select-sm">
                                    <option value="">Todas</option>
                                    ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label class="form-label">Días (Min)</label>
                                <input type="number" name="dias" class="form-control form-control-sm" value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-2 d-flex align-items-end">
                                <button type="submit" class="btn btn-primary btn-sm w-100">Filtrar</button>
                            </div>
                        </form>

                        <form id="formEnvio">
                            <div class="table-responsive" style="max-height: 500px; overflow-y: auto;">
                                <table class="table table-sm table-hover border">
                                    <thead class="table-light sticky-top">
                                        <tr>
                                            <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                            <th>Cliente</th>
                                            <th>Factura</th>
                                            <th>Saldo</th>
                                            <th>Días</th>
                                            <th>Vendedor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${deudores.map(d => `
                                            <tr>
                                                <td><input type="checkbox" name="f" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                                <td><small>${d.nombres}</small></td>
                                                <td><small>${d.nro_factura}</small></td>
                                                <td class="text-danger"><b>$${parseFloat(d.saldo_pendiente).toFixed(2)}</b></td>
                                                <td><span class="badge bg-warning text-dark">${d.dias_transcurridos}</span></td>
                                                <td><small>${d.vendedor_nom}</small></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <button type="button" onclick="enviarMensajes()" id="btnEnviar" class="btn btn-success w-100 mt-3">🚀 Enviar WhatsApp Seleccionados</button>
                        </form>
                    </div>
                    <script>
                        document.getElementById('selectAll').onclick = function() {
                            const checks = document.querySelectorAll('.rowCheck');
                            for (const c of checks) c.checked = this.checked;
                        }
                        async function enviarMensajes() {
                            const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if (selected.length === 0) return alert('Seleccione facturas');
                            if (!confirm('¿Enviar mensajes a ' + selected.length + ' clientes?')) return;

                            const btn = document.getElementById('btnEnviar');
                            btn.disabled = true; btn.innerText = 'Enviando...';

                            try {
                                const res = await fetch('/enviar-cobranza', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ facturas: selected })
                                });
                                const textoRes = await res.text();
                                alert(textoRes);
                            } catch(e) { alert('Error en el envío'); }
                            btn.disabled = false; btn.innerText = '🚀 Enviar WhatsApp Seleccionados';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (error) {
            res.writeHead(500);
            res.end("Error cargando panel de cobranza");
        }
    } 
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (socketBot && data.facturas) {
                    cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                    res.writeHead(200); res.end('Envío masivo iniciado con éxito.');
                } else {
                    res.writeHead(400); res.end('Error: El bot no está conectado o no hay facturas.');
                }
            } catch(e) { res.writeHead(500); res.end('Error procesando el envío.'); }
        });
    }
    else if (path === '/enviar-pago' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (socketBot && data.telefono && data.mensaje) {
                    let num = data.telefono.replace(/\D/g, '');
                    if (!num.startsWith('58')) num = '58' + num;
                    const jid = `${num}@s.whatsapp.net`;
                    await socketBot.sendMessage(jid, { text: data.mensaje });
                    res.writeHead(200); res.end('OK');
                } else {
                    res.writeHead(400); res.end('Faltan datos para el pago');
                }
            } catch(e) { res.writeHead(500); res.end('Error en el envío del pago'); }
        });
    }
    else {
        // Página principal: QR y Estado
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:50px;">
                <h1>Escanea ONE4CARS</h1>
                <img src="${qrCodeData}" width="300">
                <br><br>
                <p>Escanea el código para conectar el bot</p>
                <a href="/cobranza" style="color:blue">Ir a Cobranza</a>
            </center>`);
        } else {
            res.write(`<center style="margin-top:100px;">
                <h1 style="color: green;">${qrCodeData || "Iniciando sistema..."}</h1>
                <br>
                <a href="/cobranza" style="padding:15px 30px; background:green; color:white; border-radius:5px; text-decoration:none; font-weight:bold;">ENTRAR AL PANEL DE COBRANZA</a>
            </center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0', () => {
    console.log(`🌍 Servidor ONE4CARS escuchando en puerto ${port}`);
});

startBot();
